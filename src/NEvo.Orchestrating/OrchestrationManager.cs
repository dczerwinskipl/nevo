using System.Reflection;
using LanguageExt;
using NEvo.Core;

namespace NEvo.Orchestrating;

public class OrchestrationManager(IOrchestrationRunner orchestrationRunner) : IOrchestrationManager
{
    private readonly IOrchestrationRunner _orchestrationRunner = Check.Null(orchestrationRunner);

    public async Task<Either<Exception, Unit>> CompleteAsync(
        Guid orchestrationId,
        CancellationToken cancellationToken
    )
    {
        var orchestrationState = (OrchestratorState)null!; // get from DB
        return await _orchestrationRunner.RunAsync(orchestrationState, cancellationToken);
    }

    public async Task<Either<Exception, Unit>> RunAsync<TData>(
        IOrchestrator<TData> orchestrator,
        TData data,
        CancellationToken cancellationToken
    ) where TData : new()
    {
        var orchestrationState = new OrchestratorState<TData>
        {
            Id = Guid.NewGuid(),
            OrchestratorType = orchestrator.GetType().AssemblyQualifiedName!, // todo: change to mapper?
            Status = OrchestratorStatus.New,
            Data = data
        };

        // save state in db
        // await _stateRepository.SaveAsync(orchestrationState);

        return await _orchestrationRunner.RunAsync(orchestrator, orchestrationState, cancellationToken);
    }
}
