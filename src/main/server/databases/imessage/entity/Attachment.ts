import { nativeImage, NativeImage } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as base64 from "byte-base64";
import { Entity, PrimaryGeneratedColumn, Column, ManyToMany, JoinTable } from "typeorm";

import { Server } from "@server/index";
import { BooleanTransformer } from "@server/databases/transformers/BooleanTransformer";
import { DateTransformer } from "@server/databases/transformers/DateTransformer";
import { Message } from "@server/databases/imessage/entity/Message";
import { getBlurHash } from "@server/databases/imessage/helpers/utils";
import { AttachmentResponse } from "@server/types";
import { FileSystem } from "@server/fileSystem";
import { basename } from "path";

@Entity("attachment")
export class Attachment {
    @PrimaryGeneratedColumn({ name: "ROWID" })
    ROWID: number;

    @ManyToMany(type => Message)
    @JoinTable({
        name: "message_attachment_join",
        joinColumns: [{ name: "attachment_id" }],
        inverseJoinColumns: [{ name: "message_id" }]
    })
    messages: Message[];

    @Column({ type: "text", nullable: false })
    guid: string;

    @Column({
        type: "integer",
        name: "created_date",
        default: 0,
        transformer: DateTransformer
    })
    createdDate: Date;

    @Column({
        type: "integer",
        name: "start_date",
        default: 0,
        transformer: DateTransformer
    })
    startDate: Date;

    @Column({ type: "text", name: "filename", nullable: false })
    filePath: string;

    @Column({ type: "text", nullable: false })
    uti: string;

    @Column({ type: "text", name: "mime_type", nullable: true })
    mimeType: string;

    @Column({ type: "integer", name: "transfer_state", default: 0 })
    transferState: number;

    @Column({
        type: "integer",
        name: "is_outgoing",
        default: 0,
        transformer: BooleanTransformer
    })
    isOutgoing: boolean;

    @Column({ type: "blob", name: "user_info", nullable: true })
    userInfo: Blob;

    @Column({ type: "text", name: "transfer_name", nullable: false })
    transferName: string;

    @Column({ type: "integer", name: "total_bytes", default: 0 })
    totalBytes: number;

    @Column({
        type: "integer",
        name: "is_sticker",
        default: 0,
        transformer: BooleanTransformer
    })
    isSticker: boolean;

    @Column({ type: "blob", name: "sticker_user_info", nullable: true })
    stickerUserInfo: Blob;

    @Column({ type: "blob", name: "attribution_info", nullable: true })
    attributionInfo: Blob;

    @Column({
        type: "integer",
        name: "hide_attachment",
        default: 0,
        transformer: BooleanTransformer
    })
    hideAttachment: boolean;
}

const handledImageMimes = ["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/tiff", "image/gif"];
export const getAttachmentResponse = async (
    attachment: Attachment,
    withData = false,
    withBlurhash = true
): Promise<AttachmentResponse> => {
    let data: Uint8Array | string = null;
    let blurhash: string = null;
    let image: NativeImage = null;

    // Get the fully qualified path
    const tableData = attachment;
    let fPath = tableData.filePath;

    // If the attachment isn't finished downloading, the path will be null
    if (fPath) {
        fPath = FileSystem.getRealPath(fPath);

        try {
            // If the attachment is a caf, let's convert it
            if (tableData.uti === "com.apple.coreaudio-format") {
                const newPath = `${FileSystem.convertDir}/${tableData.guid}.mp3`;

                // If the path doesn't exist, let's convert the attachment
                let failed = false;
                if (!fs.existsSync(newPath)) {
                    try {
                        Server().log(`Converting attachment, ${tableData.transferName}, to an MP3...`);
                        await FileSystem.convertCafToMp3(tableData, newPath);
                    } catch (ex) {
                        failed = true;
                        Server().log(`Failed to convert CAF to MP3 for attachment, ${tableData.transferName}`);
                        Server().log(ex, "error");
                    }
                }

                if (!failed) {
                    // If conversion is successful, we need to modify the attachment a bit
                    tableData.mimeType = "audio/mp3";
                    tableData.filePath = newPath;
                    tableData.transferName = basename(newPath).replace(".caf", ".mp3");

                    // Set the fPath to the newly converted path
                    fPath = newPath;
                }
            }

            const exists = fs.existsSync(fPath);
            if (exists) {
                // Try to read the file
                const fopen = fs.readFileSync(fPath);

                // If we want data, get the data
                if (withData) {
                    data = Uint8Array.from(fopen);
                }

                if (handledImageMimes.includes(tableData.mimeType)) {
                    image = nativeImage.createFromPath(fPath);
                    if (withBlurhash) {
                        blurhash = await getBlurHash(image);
                    }
                }

                // If there is no data, return null for the data
                // Otherwise, convert it to a base64 string
                if (!data) {
                    data = null;
                } else {
                    data = base64.bytesToBase64(data as Uint8Array);
                }
            }
        } catch (ex) {
            console.log(ex);
            Server().log(`Could not read file [${fPath}]: ${ex.message}`, "error");
        }
    } else {
        console.warn("Attachment hasn't been downloaded yet!");
    }

    return {
        originalROWID: tableData.ROWID,
        guid: tableData.guid,
        messages: tableData.messages ? tableData.messages.map(item => item.guid) : [],
        data: data as string,
        height: image ? image.getSize().height : 0,
        width: image ? image.getSize().width : 0,
        blurhash,
        uti: tableData.uti,
        mimeType: tableData.mimeType,
        transferState: tableData.transferState,
        isOutgoing: tableData.isOutgoing,
        transferName: tableData.transferName,
        totalBytes: tableData.totalBytes,
        isSticker: tableData.isSticker,
        hideAttachment: tableData.hideAttachment
    };
};
