using LanguageExt;

namespace NEvo.Orchestrating;

public interface IOrchestrationManager
{
    public Task<Either<Exception, Unit>> RunAsync<TData>(
        IOrchestrator<TData> orchestrator,
        TData data
    ) where TData : new();

    public Task<Either<Exception, Unit>> CompleteAsync(
        Guid orchestrationId
    );
}
