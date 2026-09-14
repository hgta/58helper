/**
 * 任务执行控制器：支持「暂停 / 继续 / 停止」。
 *
 * 设计要点：
 * - 所有耗时的等待都走 ctrl.sleep()，等待期间可被暂停（挂起）和停止（立即结束）打断。
 * - 关键执行点调用 ctrl.checkpoint()：暂停时挂起；停止时抛出 TaskAbortError。
 * - 用 runId 隔离新旧任务：旧任务被停止后，即使仍有残留异步回调，
 *   也无法影响新一轮任务的执行状态（不会出现「僵尸任务」继续跑）。
 *
 * 典型用法：
 *   const runId = ctrl.begin();
 *   try {
 *       await ctrl.checkpoint(runId);
 *       await ctrl.sleep(3000, runId);
 *   } finally {
 *       ctrl.end(runId);
 *   }
 */
const { EventEmitter } = require('events');

/** 任务被停止时抛出，调用方据此与非中断类错误区分处理 */
class TaskAbortError extends Error {
    constructor(message) {
        super(message || '任务已被用户停止');
        this.name = 'TaskAbortError';
        this.aborted = true;
    }
}

class TaskControl extends EventEmitter {
    constructor() {
        super();
        this.status = 'idle'; // idle | running | paused | stopping
        this.runId = 0;
        this._resumeWaiters = [];
        this._stopWaiters = [];
        // 进度：done / total 为「工作单元」数（一个元素或一个普通步骤算一个单元）
        this.progress = { done: 0, total: 0, label: '' };
        // 计时：用于统计任务真实耗时（暂停时间不计入）
        this.startedAt = null;
        this._pausedMs = 0;
        this._pausedAt = null;
    }

    /** 开始一轮任务，返回本轮 runId */
    begin() {
        this.runId += 1;
        this.status = 'running';
        this._resumeWaiters = [];
        this._stopWaiters = [];
        this.progress = { done: 0, total: 0, label: '' };
        this.startedAt = Date.now();
        this._pausedMs = 0;
        this._pausedAt = null;
        this._emit();
        return this.runId;
    }

    /** 结束一轮任务；仅当 runId 匹配时才改动状态，避免旧任务干扰新任务 */
    end(runId) {
        if (runId !== undefined && runId !== this.runId) return;
        this.status = 'idle';
        this._resumeWaiters = [];
        this._stopWaiters = [];
        this.progress = { done: 0, total: 0, label: '' };
        this.startedAt = null;
        this._pausedMs = 0;
        this._pausedAt = null;
        this._emit();
    }

    /** 暂停；仅在 running 时有效 */
    pause() {
        if (this.status !== 'running') return false;
        this.status = 'paused';
        this._pausedAt = Date.now();
        this._emit();
        return true;
    }

    /** 继续；仅在 paused 时有效 */
    resume() {
        if (this.status !== 'paused') return false;
        this._settlePause();
        this.status = 'running';
        this._releaseResumeWaiters();
        this._emit();
        return true;
    }

    /** 停止；返回 false 表示当前没有可停止的任务 */
    stop() {
        if (this.status === 'idle' || this.status === 'stopping') return false;
        const wasPaused = this.status === 'paused';
        if (wasPaused) this._settlePause();
        this.status = 'stopping';
        this._releaseResumeWaiters();
        const waiters = this._stopWaiters;
        this._stopWaiters = [];
        for (const w of waiters) w();
        this._emit();
        return { wasPaused };
    }

    getState() {
        return {
            status: this.status,
            runId: this.runId,
            progress: { ...this.progress },
            elapsedMs: this.getElapsedMs()
        };
    }

    /** 本轮任务已消耗的有效时长（不含暂停时间） */
    getElapsedMs() {
        if (this.startedAt === null) return 0;
        let ms = Date.now() - this.startedAt - this._pausedMs;
        if (this._pausedAt !== null) ms -= (Date.now() - this._pausedAt);
        return Math.max(0, ms);
    }

    // ===== 进度上报（用于估算剩余耗时）=====

    /** 新增待完成的工作单元数（真实数量在运行时才能确定，例如扫描出的元素个数） */
    addProgressTotal(count, label) {
        const n = Number(count);
        if (!Number.isFinite(n) || n <= 0) return;
        this.progress.total += n;
        if (label) this.progress.label = label;
        this._emit();
    }

    /** 完成若干个工作单元 */
    tickProgress(count = 1, label) {
        const n = Number(count);
        if (!Number.isFinite(n) || n <= 0) return;
        this.progress.done = Math.min(this.progress.total, this.progress.done + n);
        if (label) this.progress.label = label;
        this._emit();
    }

    /** 任务收尾：把进度补满，避免 UI 停在 79/80 */
    finishProgress() {
        this.progress.done = this.progress.total;
        this._emit();
    }

    _settlePause() {
        if (this._pausedAt !== null) {
            this._pausedMs += Date.now() - this._pausedAt;
            this._pausedAt = null;
        }
    }

    /** 是否已被停止（runId 不匹配也视为已停止，防止旧任务继续） */
    isStopped(runId) {
        if (!this._isCurrent(runId)) return true;
        return this.status === 'stopping' || this.status === 'idle';
    }

    /** 暂停时挂起，直到「继续」或「停止」 */
    async waitIfPaused(runId) {
        while (this._isCurrent(runId) && this.status === 'paused') {
            await new Promise(resolve => this._resumeWaiters.push(resolve));
        }
    }

    /**
     * 可中断等待。返回 false 表示任务已被停止，调用方应立即结束当前流程。
     * 等待期间处于暂停状态时，计时会挂起（不会在暂停时白白消耗等待时间）。
     */
    async sleep(ms, runId) {
        await this.waitIfPaused(runId);
        if (this.isStopped(runId)) return false;

        const chunk = 200;
        let remaining = Math.max(0, Number(ms) || 0);
        while (remaining > 0) {
            const step = Math.min(chunk, remaining);
            await new Promise(resolve => setTimeout(resolve, step));
            remaining -= step;
            await this.waitIfPaused(runId);
            if (this.isStopped(runId)) return false;
        }
        return !this.isStopped(runId);
    }

    /** 检查点：暂停则挂起；停止则抛出 TaskAbortError */
    async checkpoint(runId) {
        await this.waitIfPaused(runId);
        if (this.isStopped(runId)) {
            throw new TaskAbortError();
        }
    }

    /** 等待 ms 毫秒并随后检查点；被停止时抛出 TaskAbortError */
    async wait(ms, runId) {
        await this.sleep(ms, runId);
        await this.checkpoint(runId);
    }

    /** 让一个 Promise 在任务被停止时提前结束（用于等页面加载等长耗时操作） */
    async abortable(promise, runId) {
        if (this.isStopped(runId)) throw new TaskAbortError();

        let onStop = null;
        const stopPromise = new Promise(resolve => {
            onStop = resolve;
            this._stopWaiters.push(resolve);
        });

        try {
            await Promise.race([promise, stopPromise]);
        } finally {
            if (onStop) {
                const idx = this._stopWaiters.indexOf(onStop);
                if (idx >= 0) this._stopWaiters.splice(idx, 1);
            }
        }
    }

    _isCurrent(runId) {
        return runId === undefined || runId === this.runId;
    }

    _releaseResumeWaiters() {
        const waiters = this._resumeWaiters;
        this._resumeWaiters = [];
        for (const w of waiters) w();
    }

    _emit() {
        this.emit('status', this.getState());
    }
}

module.exports = { TaskControl, TaskAbortError };
