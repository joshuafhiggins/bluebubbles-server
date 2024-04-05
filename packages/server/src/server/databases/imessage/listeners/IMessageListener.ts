import fs from "fs";
import { MultiFileWatcher } from "@server/lib/MultiFileWatcher";
import type { FileChangeEvent } from "@server/lib/MultiFileWatcher";
import { Loggable } from "@server/lib/logging/Loggable";
import { Sema } from "async-sema";
import { IMessageCache, IMessagePoller } from "../pollers";
import { MessageRepository } from "..";
import { waitMs } from "@server/helpers/utils";
import { DebounceSubsequentWithWait } from "@server/lib/decorators/DebounceDecorator";

export class IMessageListener extends Loggable {
    tag = "IMessageListener";

    stopped: boolean;

    filePaths: string[];

    watcher: MultiFileWatcher;

    repo: MessageRepository;

    processLock: Sema;

    pollers: IMessagePoller[];

    cache: IMessageCache;

    lastCheck = 0;

    constructor({ filePaths, repo, cache }: { filePaths: string[], repo: MessageRepository, cache: IMessageCache }) {
        super();

        this.filePaths = filePaths;
        this.repo = repo;
        this.pollers = [];
        this.cache = cache;
        this.stopped = false;
        this.processLock = new Sema(1);
    }

    stop() {
        this.stopped = true;
        this.removeAllListeners();
    }

    addPoller(poller: IMessagePoller) {
        this.pollers.push(poller);
    }

    getEarliestModifiedDate() {
        let earliest = new Date();
        for (const filePath of this.filePaths) {
            const stat = fs.statSync(filePath);
            if (stat.mtime < earliest) {
                earliest = stat.mtime;
            }
        }

        return earliest;
    }

    async start() {
        this.lastCheck = 0;
        this.stopped = false;

        // Perform an initial poll to kinda seed the cache.
        // We'll use the earliest modified date of the files to determine the initial poll date.
        // We'll also subtract 1 minute just to pre-load the cache with a little bit of data.
        await this.poll(new Date(this.getEarliestModifiedDate().getTime() - 60000), false);

        this.watcher = new MultiFileWatcher(this.filePaths);
        this.watcher.on("change", async (event: FileChangeEvent) => {
            await this.handleChangeEvent(event);
        });

        this.watcher.on("error", (error) => {
            this.log.error(`Failed to watch database files: ${this.filePaths.join(", ")}`);
            this.log.debug(`Error: ${error}`);
        });

        this.watcher.start();
    }

    @DebounceSubsequentWithWait('IMessageListener.handleChangeEvent', 500)
    async handleChangeEvent(event: FileChangeEvent) {
        this.log.debug(`Detected change in database files: ${event.filePath}`);
        await this.processLock.acquire();

        // Check against the last check using the current change timestamp
        if (event.currentStat.mtimeMs > this.lastCheck) {
            this.log.debug(`Processing DB change: ${event.currentStat.mtimeMs} > ${this.lastCheck}`);
            // Update the last check time.
            // We'll use the currentStat's mtimeMs - the time it took to poll.
            this.lastCheck = event.currentStat.mtimeMs;
            this.log.debug(`Saving last check time: ${this.lastCheck}`);
            // Use the previousStat's mtimeMs - 30 seconds to account for any time drift.
            // This allows us to fetch everything since the last mtimeMs.
            await this.poll(new Date(event.prevStat.mtimeMs - 30000));

            // Trim the cache so it doesn't get too big
            this.cache.trimCaches();

            if (this.processLock.nrWaiting() > 0) {
                await waitMs(100);
            }
        } else {
            this.log.debug(`Not processing DB change: ${event.currentStat.mtimeMs} <= ${this.lastCheck}`);
        }

        this.processLock.release();
    }

    async poll(after: Date, emitResults = true) {
        for (const poller of this.pollers) {
            const startMs = new Date().getTime();
            const results = await poller.poll(after);

            if (emitResults) {
                for (const result of results) {
                    this.emit(result.eventType, result.data);
                }
            }

            const endMs = new Date().getTime();
            // this.log.debug(`${poller.tag} took ${endMs - startMs}ms`);
        }
    }
}
