import {
  DecodedMessage,
  Client as XmtpClient,
  type XmtpEnv,
  type Conversation,
} from "@xmtp/node-sdk";
import { createSigner, getEncryptionKeyFromHex } from "./helper.ts";

import {
  composeContext,
  Content,
  elizaLogger,
  Memory,
  ModelClass,
  stringToUuid,
  messageCompletionFooter,
  generateMessageResponse,
  Client,
  IAgentRuntime,
} from "@elizaos/core";

let client: XmtpClient = null;
let elizaRuntime: IAgentRuntime = null;

export const messageHandlerTemplate =
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
` + messageCompletionFooter;

export const XmtpClientInterface: Client = {
  start: async (runtime: IAgentRuntime) => {
    if (!client) {
      elizaRuntime = runtime;

      const signer = createSigner(process.env.WALLET_KEY as `0x${string}`);
      const encryptionKey = getEncryptionKeyFromHex(
        process.env.ENCRYPTION_KEY as string
      );
      const env: XmtpEnv = "production";

      elizaLogger.success(`Creating client on the '${env}' network...`);
      client = await XmtpClient.create(signer, encryptionKey, {
        env,
      });

      elizaLogger.success("Syncing conversations...");
      await client.conversations.sync();

      elizaLogger.success(
        `Agent initialized on ${client.accountAddress}\nSend a message on http://xmtp.chat/dm/${client.accountAddress}?env=${env}`
      );

      elizaLogger.success("Waiting for messages...");
      const stream = client.conversations.streamAllMessages();

      elizaLogger.success("✅ XMTP client started");

      for await (const message of await stream) {
        if (
          message?.senderInboxId.toLowerCase() ===
            client.inboxId.toLowerCase() ||
          message?.contentType?.typeId !== "text"
        ) {
          continue;
        }

        // Ignore own messages
        if (message.senderInboxId === client.inboxId) {
          continue;
        }

        elizaLogger.success(
          `Received message: ${message.content as string} by ${
            message.senderInboxId
          }`
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
  stop: async (_runtime: IAgentRuntime) => {
    elizaLogger.warn("XMTP client does not support stopping yet");
  },
};

const processMessage = async (
  message: DecodedMessage,
  conversation: Conversation
) => {
  try {
    const text = message?.content?.text ?? "";
    const messageId = stringToUuid(message.id as string);
    const userId = stringToUuid(message.senderInboxId as string);
    const roomId = stringToUuid(message.conversationId as string);
    await elizaRuntime.ensureConnection(
      userId,
      roomId,
      message.senderInboxId,
      message.senderInboxId,
      "xmtp"
    );

    const content: Content = {
      text,
      source: "xmtp",
      inReplyTo: undefined,
    };

    const userMessage = {
      content,
      userId,
      roomId,
      agentId: elizaRuntime.agentId,
    };

    const memory: Memory = {
      id: messageId,
      agentId: elizaRuntime.agentId,
      userId,
      roomId,
      content,
      createdAt: Date.now(),
    };

    await elizaRuntime.messageManager.createMemory(memory);

    const state = await elizaRuntime.composeState(userMessage, {
      agentName: elizaRuntime.character.name,
    });

    const context = composeContext({
      state,
      template: messageHandlerTemplate,
    });

    const response = await generateMessageResponse({
      runtime: elizaRuntime,
      context,
      modelClass: ModelClass.LARGE,
    });
    const _newMessage = [
      {
        text: response?.text,
        source: "xmtp",
        inReplyTo: messageId,
      },
    ];
    // save response to memory
    const responseMessage = {
      ...userMessage,
      userId: elizaRuntime.agentId,
      content: response,
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
            inReplyTo: undefined,
          });
        }
        return [memory];
      }
    );
    for (const newMsg of _newMessage) {
      await conversation?.send(newMsg.text);
    }
  } catch (error) {
    elizaLogger.error("Error in onMessage", error);
  }
};

export default XmtpClientInterface;
