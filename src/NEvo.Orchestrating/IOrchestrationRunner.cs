using LanguageExt;

namespace NEvo.Orchestrating;

public interface IOrchestrationRunner
{
    public Task<Either<Exception, Unit>> RunAsync<TData>(
        IOrchestrator<TData> orchestrator,
        OrchestratorState<TData> state,
        CancellationToken cancellationToken
    ) where TData : new();
}
