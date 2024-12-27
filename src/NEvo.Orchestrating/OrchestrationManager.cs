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
        var orchestrationState = (OrchestratorState)null!;

        return await (
            from orchestratorType in ResolveOrchestratorType(orchestrationState)
            from dataType in GetOrchestratorDataType(orchestratorType)
            from orchestrator in CreateOrchestratorInstance(orchestratorType)
            select (Orchestrator: orchestrator, DataType: dataType)
        )
        .BindAsync(
            tuple => InvokeRunAsync(tuple.Orchestrator, orchestrationState, tuple.DataType, cancellationToken)
        );
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

    private async Task<Either<Exception, Unit>> InvokeRunAsync(
        object orchestrator,
        object state,
        Type dataType,
        CancellationToken cancellationToken
    )
    {
        var method = typeof(IOrchestrationRunner)
            .GetMethod(nameof(IOrchestrationRunner.RunAsync), BindingFlags.Public | BindingFlags.Instance)
            ?.MakeGenericMethod(dataType);

        if (method == null)
        {
            return new InvalidOperationException("Failed to find RunAsync method.");
        }

        return await (Task<Either<Exception, Unit>>)method.Invoke(_orchestrationRunner, [orchestrator, state, cancellationToken])!;
    }

    private static Either<Exception, Type> ResolveOrchestratorType(OrchestratorState orchestrationState)
    {
        var type = Type.GetType(orchestrationState.OrchestratorType);
        if (type == null)
        {
            return new InvalidOperationException("Cannot resolve orchestrator type.");
        }

        return type;
    }

    private static Either<Exception, object> CreateOrchestratorInstance(Type orchestratorType)
    {
        var instance = Activator.CreateInstance(orchestratorType);
        if (instance == null)
        {
            return new InvalidOperationException($"Failed to create orchestrator of type: {orchestratorType.Name}");
        }

        return instance;
    }

    private static Either<Exception, Type> GetOrchestratorDataType(Type orchestratorType)
    {
        var orchestratorInterface = orchestratorType
            .GetInterfaces()
            .FirstOrDefault(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IOrchestrator<>));

        if (orchestratorInterface == null)
        {
            return new InvalidOperationException("The orchestrator type does not implement IOrchestrator<TData>.");
        }

        return orchestratorInterface.GetGenericArguments()[0];
    }
}
