import { Server } from "@server";
import { FT_CALL_STATUS_CHANGED } from "@server/events";
import { EventData, PrivateApiEventHandler } from ".";
import { HandleResponse } from "@server/types";
import { slugifyAddress } from "@server/helpers/utils";
import { HandleSerializer } from "@server/api/serializers/HandleSerializer";
import { FaceTimeSession } from "@server/api/lib/facetime/FaceTimeSession";
import { isMinVentura } from "@server/env";
import { FaceTimeSessionManager } from "@server/api/lib/facetime/FacetimeSessionManager";

type FaceTimeStatusData = {
    uuid: string;
    status_id: number;
    status: string;
    ended_error: string;
    ended_reason: string;
    address: string;
    handle?: HandleResponse;
    image_url: string;
    is_outgoing: boolean;
    is_audio: boolean;
    is_video: boolean;
    url?: string | null;
};


export class PrivateApiFaceTimeStatusHandler implements PrivateApiEventHandler {

    types: string[] = ["ft-call-status-changed"];

    callStatusMap: Record<number, string> = {
        1: "answered",
        3: "outgoing",
        4: "incoming",
        // Ended
        // Unanswered
        // Declined
        6: "disconnected",
    };

    async handle(data: EventData) {
        // Don't do anything for an outgoing call or answered call
        if ([1, 3].includes(data.data.call_status)) return;
        if (!data.data.handle) return;

        if (data.data.call_status === 4) {
            Server().log(`Incoming FaceTime call from ${data.data.handle.value}`);

            // Check the cache to see if we've already gotten an this request
            const id = `ft-${data.data.call_status}-${data.data.call_uuid}`;
            const wasHandled = Server().eventCache.find(id);
            if (wasHandled) return;
            Server().eventCache.add(id);
        } else if (data.data.call_status === 6) {
            Server().log(`FaceTime call disconnected with ${data.data.handle.value}`);
        }

        const addr = slugifyAddress(data.data.handle.value);
        const [handle, _] = await Server().iMessageRepo.getHandles({ address: addr, limit: 1 });

        // Build a payload to be sent out to clients.
        // We just alias some of the data to make it easier to work with.
        const output: FaceTimeStatusData = {
            uuid: data.data.call_uuid,
            status: this.callStatusMap[data.data.call_status] ?? "unknown",
            status_id: data.data.call_status,
            ended_error: data.data.ended_error,
            ended_reason: data.data.ended_reason,
            address: data.data.handle.value,
            handle: handle[0] ? await HandleSerializer.serialize({ handle: handle[0] }) : null,
            image_url: data.data.image_url ?? null,
            is_outgoing: data.data.is_outgoing ?? false,
            is_audio: data.data.is_sending_audio ?? false,
            is_video: data.data.is_sending_video ?? true,
        };

        // If the status is 4, it's an incoming call and we should create a FaceTime session for it.
        if (data.data.call_status === 4 && isMinVentura) {
            try {
                // We don't want to wait for the entire flow to execute so we just wait for the link
                const link = await this.answerAndWaitForLink(data.data.call_uuid);
                output.url = link;
            } catch (ex: any) {
                Server().log(`Failed to get FaceTime link for call ${data.data.call_uuid}: ${ex.message}`, "error");
            }
        } else if (data.data.call_status === 6 && isMinVentura) {
            FaceTimeSessionManager().invalidateSession(data.data.call_uuid);
        }

        Server().emitMessage(FT_CALL_STATUS_CHANGED, output, "high", true);
    }

    private async answerAndWaitForLink(callUuid: string): Promise<string> {
        return await new Promise((resolve, reject) => {
            try {
                FaceTimeSession.answerIncomingCall(callUuid, (link: string) => {
                    resolve(link);
                });
            } catch (ex) {
                reject(ex);
            }
        });
    }
}