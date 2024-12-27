using LanguageExt;

using static LanguageExt.Prelude;

namespace NEvo.Orchestrating;

public class StepExecutor : IStepExecutor
{
    public virtual async Task<Either<Exception, Unit>> ExecuteAsync<TData>(
        IOrchestratorStep<TData> step,
        OrchestratorState<TData> state,
        CancellationToken cancellationToken
    ) where TData : new()
        => (await TryAsync(() => step.ExecuteAsync(state.Data, cancellationToken)))
            .ToEither(ex => ex)
            .Flatten()
            .Do(x => state.LastStep = step.Name);

    public virtual async Task<Either<Exception, Unit>> CompensateAsync<TData>(
        IOrchestratorStep<TData> step,
        OrchestratorState<TData> state,
        CancellationToken cancellationToken
    ) where TData : new()
        => (await TryAsync(() => step.CompensateAsync(state.Data, cancellationToken)))
            .ToEither(ex => ex)
            .Flatten()
            .Do(x => state.LastCompensatedStep = step.Name);
}
