using LanguageExt;

namespace NEvo.Orchestrating;

public interface IStepExecutor
{
    Task<Either<Exception, Unit>> ExecuteAsync<TData>(
        IOrchestratorStep<TData> step,
        OrchestratorState<TData> state,
        CancellationToken cancellationToken
    ) where TData : new();

    Task<Either<Exception, Unit>> CompensateAsync<TData>(
        IOrchestratorStep<TData> step,
        OrchestratorState<TData> state,
        CancellationToken cancellationToken
    ) where TData : new();
}
