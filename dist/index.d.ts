import { Plugin, Client } from '@elizaos/core';

declare const messageHandlerTemplate: string;
declare const XmtpClientInterface: Client;
declare const xmtpPlugin: Plugin;

export { XmtpClientInterface, xmtpPlugin as default, messageHandlerTemplate };
