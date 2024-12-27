using System.Reflection;
using LanguageExt;

namespace NEvo.Orchestrating;

public static class OrchestrationRunnerReflectionHelper
{
    public static async Task<Either<Exception, Unit>> RunAsync(
        this IOrchestrationRunner _orchestrationRunner,
        OrchestratorState orchestrationState,
        CancellationToken cancellationToken
    ) => await (
        from orchestratorType in ResolveOrchestratorType(orchestrationState)
        from dataType in GetOrchestratorDataType(orchestratorType)
        from orchestrator in CreateOrchestratorInstance(orchestratorType)
        select (Orchestrator: orchestrator, DataType: dataType)
    )
    .BindAsync(
        tuple => _orchestrationRunner.InvokeRunAsync(tuple.Orchestrator, orchestrationState, tuple.DataType, cancellationToken)
    );

    private static async Task<Either<Exception, Unit>> InvokeRunAsync(
        this IOrchestrationRunner _orchestrationRunner,
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
