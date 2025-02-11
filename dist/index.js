// src/client.ts
import {
  Client as XmtpClient
} from "@xmtp/node-sdk";

// src/helper.ts
import { fromString, toString } from "uint8arrays";
import { toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
var createSigner = (privateKey) => {
  const account = privateKeyToAccount(privateKey);
  return {
    getAddress: () => account.address,
    signMessage: async (message) => {
      const signature = await account.signMessage({
        message
      });
      return toBytes(signature);
    }
  };
};
var getEncryptionKeyFromHex = (hex) => {
  return fromString(hex, "hex");
};

// src/client.ts
import {
  composeContext,
  elizaLogger,
  ModelClass,
  stringToUuid,
  messageCompletionFooter,
  generateMessageResponse
} from "@elizaos/core";
var client = null;
var elizaRuntime = null;
var messageHandlerTemplate = (
  // {{goals}}
  `# Action Examples
{{actionExamples}}
(Action examples are for reference only. Do not use the information from them in your response.)

# Knowledge
{{knowledge}}

# Task: Generate dialog and actions for the character {{agentName}}.
About {{agentName}}:
{{bio}}
{{lore}}

{{providers}}

{{attachments}}

# Capabilities
Note that {{agentName}} is capable of reading/seeing/hearing various forms of media, including images, videos, audio, plaintext and PDFs. Recent attachments have been included above under the "Attachments" section.

{{messageDirections}}

{{recentMessages}}

{{actions}}

# Instructions: Write the next message for {{agentName}}.
` + messageCompletionFooter
);
var XmtpClientInterface = {
  start: async (runtime) => {
    var _a;
    if (!client) {
      elizaRuntime = runtime;
      const signer = createSigner(process.env.WALLET_KEY);
      const encryptionKey = getEncryptionKeyFromHex(
        process.env.ENCRYPTION_KEY
      );
      const env = "production";
      elizaLogger.success(`Creating client on the '${env}' network...`);
      client = await XmtpClient.create(signer, encryptionKey, {
        env
      });
      elizaLogger.success("Syncing conversations...");
      await client.conversations.sync();
      elizaLogger.success(
        `Agent initialized on ${client.accountAddress}
Send a message on http://xmtp.chat/dm/${client.accountAddress}?env=${env}`
      );
      elizaLogger.success("Waiting for messages...");
      const stream = client.conversations.streamAllMessages();
      elizaLogger.success("\u2705 XMTP client started");
      for await (const message of await stream) {
        if ((message == null ? void 0 : message.senderInboxId.toLowerCase()) === client.inboxId.toLowerCase() || ((_a = message == null ? void 0 : message.contentType) == null ? void 0 : _a.typeId) !== "text") {
          continue;
        }
        if (message.senderInboxId === client.inboxId) {
          continue;
        }
        elizaLogger.success(
          `Received message: ${message.content} by ${message.senderInboxId}`
        );
        const conversation = client.conversations.getConversationById(
          message.conversationId
        );
        if (!conversation) {
          console.log("Unable to find conversation, skipping");
          continue;
        }
        elizaLogger.success(`Sending "gm" response...`);
        await processMessage(message, conversation);
        elizaLogger.success("Waiting for messages...");
      }
      return client;
    }
  },
  stop: async (_runtime) => {
    elizaLogger.warn("XMTP client does not support stopping yet");
  }
};
var processMessage = async (message, conversation) => {
  var _a;
  try {
    const text = ((_a = message == null ? void 0 : message.content) == null ? void 0 : _a.text) ?? "";
    const messageId = stringToUuid(message.id);
    const userId = stringToUuid(message.senderInboxId);
    const roomId = stringToUuid(message.conversationId);
    await elizaRuntime.ensureConnection(
      userId,
      roomId,
      message.senderInboxId,
      message.senderInboxId,
      "xmtp"
    );
    const content = {
      text,
      source: "xmtp",
      inReplyTo: void 0
    };
    const userMessage = {
      content,
      userId,
      roomId,
      agentId: elizaRuntime.agentId
    };
    const memory = {
      id: messageId,
      agentId: elizaRuntime.agentId,
      userId,
      roomId,
      content,
      createdAt: Date.now()
    };
    await elizaRuntime.messageManager.createMemory(memory);
    const state = await elizaRuntime.composeState(userMessage, {
      agentName: elizaRuntime.character.name
    });
    const context = composeContext({
      state,
      template: messageHandlerTemplate
    });
    const response = await generateMessageResponse({
      runtime: elizaRuntime,
      context,
      modelClass: ModelClass.LARGE
    });
    const _newMessage = [
      {
        text: response == null ? void 0 : response.text,
        source: "xmtp",
        inReplyTo: messageId
      }
    ];
    const responseMessage = {
      ...userMessage,
      userId: elizaRuntime.agentId,
      content: response
    };
    await elizaRuntime.messageManager.createMemory(responseMessage);
    if (!response) {
      elizaLogger.error("No response from generateMessageResponse");
      return;
    }
    await elizaRuntime.evaluate(memory, state);
    const _result = await elizaRuntime.processActions(
      memory,
      [responseMessage],
      state,
      async (newMessages) => {
        if (newMessages.text) {
          _newMessage.push({
            text: newMessages.text,
            source: "xmtp",
            inReplyTo: void 0
          });
        }
        return [memory];
      }
    );
    for (const newMsg of _newMessage) {
      await (conversation == null ? void 0 : conversation.send(newMsg.text));
    }
  } catch (error) {
    elizaLogger.error("Error in onMessage", error);
  }
};

// src/index.ts
var xmtpPlugin = {
  name: "xmtp",
  description: "XMTP client",
  clients: [XmtpClientInterface]
};
var index_default = xmtpPlugin;
export {
  index_default as default
};
//# sourceMappingURL=index.js.map