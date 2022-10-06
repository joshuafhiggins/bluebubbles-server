import { DateTransformer } from "@server/databases/transformers/DateTransformer";
import { JsonTransformer } from "@server/databases/transformers/JsonTransformer";
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from "typeorm";

@Entity({ name: "scheduled_message" })
export class ScheduledMessage {
    @PrimaryGeneratedColumn({ name: "id" })
    id: number;

    // The type of message to send
    @Column("text", { name: "type", nullable: false })
    type: string;

    // JSON String containing the data to send for the message
    @Column("text", { name: "payload", nullable: false, transformer: JsonTransformer })
    payload: NodeJS.Dict<any>;

    // The timestamp to send the message at
    @Column("date", { name: "scheduled_for", nullable: true, transformer: DateTransformer })
    scheduledFor: Date;

    // JSON String containing metadata around the schedule
    @Column("text", { name: "schedule", nullable: false, transformer: JsonTransformer })
    schedule: NodeJS.Dict<any>;

    // The current status of the scheduled message
    @Column("text", { name: "status", nullable: false, default: "pending" })
    status: string;

    // The error message
    @Column("text", { name: "error", nullable: true, default: null })
    error: string;

    // The timestamp the message was sent at
    @Column("date", { name: "sent_at", nullable: true, transformer: DateTransformer })
    sentAt: Date;

    @CreateDateColumn()
    created: Date;
}