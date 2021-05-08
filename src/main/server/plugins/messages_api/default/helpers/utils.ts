import * as fs from "fs";

import { nativeImage, NativeImage } from "electron";
import { basename } from "path";
import { encode as blurHashEncode } from "blurhash";

import { Server } from "@server/index";
import { FileSystem } from "@server/fileSystem";
import { Metadata } from "@server/fileSystem/types";
import type { MessageDbSpec, MessageSpec } from "@server/specs/iMessageSpec";

import type { Attachment } from "../entity/Attachment";
import type { Message } from "../entity/Message";
import { handledImageMimes } from "./constants";
import { ApiEvent } from "../../types";

export const getBlurHash = async (image: NativeImage) => {
    let blurhash: string = null;
    let calcImage = image;

    try {
        let size = calcImage.getSize();

        // If the image is "too big", rescale it so blurhash is computed faster
        if (size.width > 320) {
            calcImage = calcImage.resize({ width: 320, quality: "good" });
            size = calcImage.getSize();
        }

        // Compute blurhash
        blurhash = blurHashEncode(Uint8ClampedArray.from(calcImage.toBitmap()), size.width, size.height, 3, 3);
    } catch (ex) {
        console.log(ex);
        Server().logger.error(`Could not compute blurhash: ${ex.message}`);
    }

    return blurhash;
};

export const getCacheName = (message: Message) => {
    const delivered = message.dateDelivered ? message.dateDelivered.getTime() : 0;
    const read = message.dateRead ? message.dateRead.getTime() : 0;
    return `${message.guid}:${delivered}:${read}`;
};

export const convertAudio = async (attachment: Attachment): Promise<string> => {
    const newPath = `${FileSystem.convertDir}/${attachment.guid}.mp3`;
    const theAttachment = attachment;

    // If the path doesn't exist, let's convert the attachment
    let failed = false;
    if (!fs.existsSync(newPath)) {
        try {
            Server().logger.info(`Converting attachment, ${theAttachment.transferName}, to an MP3...`);
            await FileSystem.convertCafToMp3(theAttachment, newPath);
        } catch (ex) {
            failed = true;
            Server().logger.error(`Failed to convert CAF to MP3 for attachment, ${theAttachment.transferName}`);
            Server().logger.error(ex);
        }
    }

    if (!failed) {
        // If conversion is successful, we need to modify the attachment a bit
        theAttachment.mimeType = "audio/mp3";
        theAttachment.filePath = newPath;
        theAttachment.transferName = basename(newPath).replace(".caf", ".mp3");

        // Set the fPath to the newly converted path
        return newPath;
    }

    return null;
};

export const getAttachmentMetadata = async (attachment: Attachment): Promise<Metadata> => {
    let metadata: Metadata;
    if (attachment.uti !== "com.apple.coreaudio-format" && !attachment.mimeType) return metadata;

    if (attachment.uti === "com.apple.coreaudio-format" || attachment.mimeType.startsWith("audio")) {
        metadata = await FileSystem.getAudioMetadata(attachment.filePath);
    } else if (attachment.mimeType.startsWith("image")) {
        metadata = await FileSystem.getImageMetadata(attachment.filePath);

        try {
            // If we got no height/width data, let's try to fallback to other code to fetch it
            if (handledImageMimes.includes(attachment.mimeType) && (!metadata?.height || !metadata?.width)) {
                Server().logger.debug("Image metadata empty, getting size from NativeImage...");

                // Load the image data
                const image = nativeImage.createFromPath(FileSystem.getRealPath(attachment.filePath));

                // If we were able to load the image, get the size
                if (image) {
                    const size = image.getSize();

                    // If the size if available, set the metadata for it
                    if (size?.height && size?.width) {
                        // If the metadata is null, let's give it some data
                        if (metadata === null) metadata = {};
                        metadata.height = size.height;
                        metadata.width = size.width;
                    }
                }
            }
        } catch (ex) {
            Server().logger.error("Failed to load size data from NativeImage!");
        }
    } else if (attachment.mimeType.startsWith("video")) {
        metadata = await FileSystem.getVideoMetadata(attachment.filePath);
    }

    return metadata;
};

export const groupMessageType = (message: MessageSpec): string => {
    const msg = message as MessageDbSpec;

    // Send the built message object
    if (msg.itemType === 1 && msg.groupActionType === 0) return ApiEvent.GROUP_PARTICIPANT_ADDED;
    if (msg.itemType === 1 && msg.groupActionType === 1) return ApiEvent.GROUP_PARTICIPANT_REMOVED;
    if (msg.itemType === 2) return ApiEvent.GROUP_NAME_CHANGE;
    if (msg.itemType === 3) return ApiEvent.GROUP_PARTICIPANT_LEFT;

    return null;
};

export const messageOverview = (message: MessageSpec): string => {
    const msg = message as MessageDbSpec;
    const msgType = msg?.isFromMe ? "Outgoing Message" : "Incoming Message";

    // If there are attachments, return the attachment count
    if ((msg?.attachments ?? []).length > 0) {
        // If there is text (more than 1 char; 1st char is the invisible char)
        if ((msg?.text ?? "").length > 1)
            return `${(msg?.attachments ?? []).length} Attachments & ${msgType}: ${msg.text}`;

        // If it's just attachments, just show that
        return `${(msg?.attachments ?? []).length} Attachments`;
    }

    // Check for a group event
    if (!msg?.text && [1, 2, 3].includes(msg?.itemType)) {
        const groupEvent = groupMessageType(message);
        return `Group Event: ${groupEvent}`;
    }

    // Check for a message reaction
    if (msg?.associatedMessageGuid && (msg?.associatedMessageType ?? 0) > 0) return `Reaction: ${msg?.text}`;

    // If all alse doesn't get caught, return the message text
    return `${msgType}: ${msg?.text ?? "N/A"}`;
};
