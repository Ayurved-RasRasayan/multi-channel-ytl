const { describe, it, expect } = require('@jest/globals');

// Test queue buffering logic directly
describe('Download Queue Buffering Logic', () => {
    it('should cap visible queue at 50 and replenish when queue drops to 10', () => {
        const downloadQueue = {
            maxConcurrent: 2,
            maxVisibleQueue: 50,
            replenishThreshold: 10,
            activeJobs: [],
            queue: [],
            pendingBuffer: [],

            replenishQueue() {
                if (this.pendingBuffer.length === 0) return;
                const currentVisible = this.activeJobs.length + this.queue.length;
                if (currentVisible <= this.replenishThreshold) {
                    const needed = this.maxVisibleQueue - currentVisible;
                    if (needed <= 0) return;
                    const toMove = this.pendingBuffer.splice(0, needed);
                    toMove.forEach(job => this.queue.push(job));
                }
            },

            enqueue(job) {
                if (this.activeJobs.length < this.maxConcurrent) {
                    this.activeJobs.push(job);
                } else if (this.activeJobs.length + this.queue.length < this.maxVisibleQueue) {
                    this.queue.push(job);
                } else {
                    this.pendingBuffer.push(job);
                }
            },

            onJobComplete(completedJobId) {
                const idx = this.activeJobs.findIndex(j => j.id === completedJobId);
                if (idx !== -1) {
                    this.activeJobs.splice(idx, 1);
                }
                this.replenishQueue();
                if (this.queue.length > 0 && this.activeJobs.length < this.maxConcurrent) {
                    const nextJob = this.queue.shift();
                    this.activeJobs.push(nextJob);
                }
            }
        };

        // 1. Enqueue 75 jobs
        for (let i = 1; i <= 75; i++) {
            downloadQueue.enqueue({ id: `job_${i}`, title: `Video ${i}` });
        }

        // Active: 2, Queue: 48 (Total visible: 50), PendingBuffer: 25
        expect(downloadQueue.activeJobs.length).toBe(2);
        expect(downloadQueue.queue.length).toBe(48);
        expect(downloadQueue.pendingBuffer.length).toBe(25);

        // 2. Complete 38 jobs (visible active+queue drops to 12, then on 39th drops to 11, on 40th drops to 10)
        for (let i = 0; i < 39; i++) {
            const activeId = downloadQueue.activeJobs[0].id;
            downloadQueue.onJobComplete(activeId);
        }

        // Active: 2, Queue: 9 (Total visible: 11 <= threshold triggers replenish on next completion)
        const activeId = downloadQueue.activeJobs[0].id;
        downloadQueue.onJobComplete(activeId);

        // Replenish triggered! Move from pendingBuffer (25) to queue
        expect(downloadQueue.pendingBuffer.length).toBe(0);
        expect(downloadQueue.activeJobs.length + downloadQueue.queue.length).toBe(35); // All remaining 35 items now in queue/active
    });
});
