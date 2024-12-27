using LanguageExt;

namespace NEvo.Orchestrating;

public interface IStepExecutor
{
    Task<Either<Exception, OrchestratorState<TData>>> ExecuteAsync<TData>(
        IOrchestratorStep<TData> step,
        OrchestratorState<TData> state,
        CancellationToken cancellationToken
    ) where TData : new();

    Task<Either<Exception, OrchestratorState<TData>>> CompensateAsync<TData>(
        IOrchestratorStep<TData> step,
        OrchestratorState<TData> state,
        CancellationToken cancellationToken
    ) where TData : new();
}
