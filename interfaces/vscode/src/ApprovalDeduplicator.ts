export class ApprovalDeduplicator {
    private readonly handled = new Set<string>();

    accept(approvalId: string): boolean {
        if (!approvalId || this.handled.has(approvalId)) return false;
        this.handled.add(approvalId);
        return true;
    }

    clear(): void {
        this.handled.clear();
    }
}
