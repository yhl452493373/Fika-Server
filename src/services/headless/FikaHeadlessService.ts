import { inject, injectable } from "tsyringe";

import type { ILogger } from "@spt/models/spt/utils/ILogger";

import { SPTWebSocket } from "@spt/servers/ws/SPTWebsocket";
import { EFikaHeadlessWSMessageTypes } from "../../models/enums/EFikaHeadlessWSMessageTypes";
import { EHeadlessStatus } from "../../models/enums/EHeadlessStatus";
import { IHeadlessClientInfo } from "../../models/fika/headless/IHeadlessClientInfo";
import { IStartHeadlessRequest } from "../../models/fika/routes/raid/headless/IStartHeadlessRequest";
import { IHeadlessRequesterJoinRaid } from "../../models/fika/websocket/headless/IHeadlessRequesterJoinRaid";
import { IStartHeadlessRaid } from "../../models/fika/websocket/headless/IHeadlessStartRaid";
import { FikaHeadlessRequesterWebSocket } from "../../websockets/FikaHeadlessRequesterWebSocket";
import { FikaHeadlessProfileService } from "./FikaHeadlessProfileService";

@injectable()
export class FikaHeadlessService {
    private headlessClients: Record<string, IHeadlessClientInfo> = {};

    constructor(
        @inject("FikaHeadlessProfileService") protected fikaHeadlessProfileService: FikaHeadlessProfileService,
        @inject("FikaHeadlessRequesterWebSocket") protected fikaHeadlessRequesterWebSocket: FikaHeadlessRequesterWebSocket,
        @inject("WinstonLogger") protected logger: ILogger,
    ) {}

    public addHeadlessClient(sessionID: string, webSocket: SPTWebSocket): void {
        this.headlessClients[sessionID] = { webSocket: webSocket, state: EHeadlessStatus.READY };
    }

    public removeHeadlessClient(sessionID: string): void {
        delete this.headlessClients[sessionID];
    }

    /** Begin setting up a raid for a headless client
     *
     * @returns returns a SessionID of the headless client that is starting this raid, returns null if no client could be found or there was an error.
     */
    public async startHeadlessRaid(requesterSessionID: string, info: IStartHeadlessRequest): Promise<string | null> {
        const headlessClientId = this.getAvailableHeadlessClient();

        if (headlessClientId === null) {
            return null;
        }

        const headlessClient = this.headlessClients[headlessClientId];

        if (headlessClient === null || headlessClient?.state != EHeadlessStatus.READY) {
            return null;
        }

        headlessClient.state = EHeadlessStatus.IN_RAID;
        headlessClient.requesterSessionID = requesterSessionID;
        headlessClient.hasNotifiedRequester = false;

        const headlessClientWS = headlessClient.webSocket;

        if (!headlessClientWS) {
            return null;
        }

        if (headlessClientWS.readyState === WebSocket.CLOSED) {
            return null;
        }

        const startRequest: IStartHeadlessRaid = {
            type: EFikaHeadlessWSMessageTypes.HeadlessStartRaid,
            startRequest: info,
        };

        await headlessClientWS.sendAsync(JSON.stringify(startRequest));

        return headlessClientId;
    }

    /** Sends a join message to the requester of a headless client */
    public async sendJoinMessageToRequester(headlessClientId: string): Promise<void> {
        const headlessClient = this.headlessClients[headlessClientId];

        if (headlessClient === null || headlessClient?.state === EHeadlessStatus.READY) {
            return null;
        }

        const message: IHeadlessRequesterJoinRaid = {
            type: EFikaHeadlessWSMessageTypes.RequesterJoinMatch,
            matchId: headlessClientId,
        };

        await this.fikaHeadlessRequesterWebSocket.sendAsync(headlessClient.requesterSessionID, message);
        headlessClient.hasNotifiedRequester = true;
    }

    /** End the raid for the specified headless client, sets the state back to READY so that he can be requested to host again. */
    public endHeadlessRaid(headlessClientId: string): void {
        const headlessClient = this.headlessClients[headlessClientId];

        if (headlessClient === null) {
            return;
        }

        headlessClient.state = EHeadlessStatus.READY;
        headlessClient.requesterSessionID = null;
        headlessClient.hasNotifiedRequester = null;
    }

    public isHeadlessClient(sessionID: string): boolean {
        return this.fikaHeadlessProfileService.isHeadlessProfile(sessionID);
    }

    /**
     * Allows for checking if there are any headless clients available
     *
     * @returns Returns true if one is available, returns false if none are available.
     */
    public HeadlessClientsAvailable(): boolean {
        return Object.values(this.headlessClients).some((client) => client.state === EHeadlessStatus.READY);
    }

    /**
     * Gets the first available headless client
     *
     * @returns Returns the SessionID of the headless client if one is available, if not returns null.
     */
    public getAvailableHeadlessClient(): string | null {
        for (const key in this.headlessClients) {
            if (this.headlessClients[key].state === EHeadlessStatus.READY) {
                return key;
            }
        }

        return null;
    }
}
