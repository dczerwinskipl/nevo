using LanguageExt;
using NEvo.Core;

namespace NEvo.Orchestrating;

public class OrchestrationRunner(IStepExecutor stepExecutor) : IOrchestrationRunner
{
    private readonly IStepExecutor _stepExecutor = Check.Null(stepExecutor);

    private static readonly List<OrchestratorStatus> FinalStates = [
        OrchestratorStatus.Completed,
        OrchestratorStatus.CompensationCompleted,
        OrchestratorStatus.CompensationFailed
    ];

    public async Task<Either<Exception, Unit>> RunAsync<TData>(
        IOrchestrator<TData> orchestrator,
        OrchestratorState<TData> state,
        CancellationToken cancellationToken
    ) where TData : new()
    {
        // re-run compensation
        if (state.Status == OrchestratorStatus.CompensationFailed)
        {
            state.Status = OrchestratorStatus.Failed;
        }

        Exception? runException = null;
        Exception? compensationException = null;

        // while succes or failed during compensation
        while (!FinalStates.Contains(state.Status))
        {
            switch (state.Status)
            {
                case OrchestratorStatus.New:
                case OrchestratorStatus.Running:
                    {
                        var result = await HandleExecuteAsync(orchestrator, state, cancellationToken);
                        result.IfLeft(exc => runException = exc);
                        break;
                    }
                case OrchestratorStatus.Failed:
                    {
                        var result = await HandleCompensationAsync(orchestrator, state, cancellationToken);
                        result.IfLeft(exc => compensationException = exc);
                        break;
                    }
                default:
                    throw new InvalidOperationException($"Invalid state: {state.Status}");
            }
        }

        return (runException, compensationException) switch
        {
            (not null, not null) => new AggregateException(runException, compensationException),
            (null, not null) => compensationException,
            (not null, null) => runException,
            _ => Unit.Default
        };
    }

    private async Task<Either<Exception, Unit>> HandleExecuteAsync<TData>(
        IOrchestrator<TData> orchestrator,
        OrchestratorState<TData> state,
        CancellationToken cancellationToken
    ) where TData : new()
    {
        state.Status = OrchestratorStatus.Running;
        var result = await ExecuteOrchestrationStepsAsync(
            GetStepsToExecute(orchestrator, state.LastStep),
            step => _stepExecutor.ExecuteAsync(step, state, cancellationToken)
        );

        return result.Do(
            _ => state.Status = OrchestratorStatus.Completed,
            _ => state.Status = OrchestratorStatus.Failed
        );
    }

    private async Task<Either<Exception, Unit>> HandleCompensationAsync<TData>(
        IOrchestrator<TData> orchestrator,
        OrchestratorState<TData> state,
        CancellationToken cancellationToken
    ) where TData : new()
    {
        var result = await ExecuteOrchestrationStepsAsync(
            GetStepsToCompensate(orchestrator, state.LastCompensatedStep ?? state.LastStep),
            step => _stepExecutor.CompensateAsync(step, state, cancellationToken)
        );

        return result.Do(
            _ => state.Status = OrchestratorStatus.CompensationCompleted,
            _ => state.Status = OrchestratorStatus.CompensationFailed
        );
    }

    private static IEnumerable<IOrchestratorStep<TData>> GetStepsToExecute<TData>(IOrchestrator<TData> orchestrator, string? lastStep) where TData : new()
    {
        return lastStep == null
            ? orchestrator.Steps
            : orchestrator.Steps.SkipWhile(steps => steps.Name != lastStep).Skip(1);
    }

    private static IEnumerable<IOrchestratorStep<TData>> GetStepsToCompensate<TData>(IOrchestrator<TData> orchestrator, string? lastStep) where TData : new()
        => lastStep == null
            ? []
            : orchestrator.Steps.Reverse().SkipWhile(steps => steps.Name != lastStep);

    private static async Task<Either<Exception, Unit>> ExecuteOrchestrationStepsAsync<TData>(
        IEnumerable<IOrchestratorStep<TData>> steps,
        Func<IOrchestratorStep<TData>, Task<Either<Exception, Unit>>> run
    ) where TData : new()
    {
        foreach (var step in steps)
        {
            var result = await run(step);
            if (result.IsLeft)
            {
                return result;
            }
        }
        return Unit.Default;
    }
}
