/// Runs `work` over `inputs`, at most `width` at a time, handing each result to
/// `onResult` as it lands. Once the calling task is cancelled nothing new
/// starts, and `onResult` hears about it alongside every result after that.
func forEachConcurrently<Input: Sendable, Output: Sendable>(
    _ inputs: [Input], width: Int,
    _ work: @escaping @Sendable (Input) async -> Output,
    onResult: (_ output: Output, _ cancelled: Bool) -> Void
) async {
    await withTaskGroup(of: Output.self) { group in
        var next = 0
        func submit() {
            guard next < inputs.count else { return }
            let input = inputs[next]
            next += 1
            group.addTask { await work(input) }
        }
        for _ in 0..<min(width, inputs.count) { submit() }

        while let output = await group.next() {
            let cancelled = Task.isCancelled
            if cancelled { group.cancelAll() } else { submit() }
            onResult(output, cancelled)
        }
    }
}
