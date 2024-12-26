using System.Security.Cryptography.X509Certificates;
using LanguageExt;

namespace NEvo.Orchestrating;

public class OrchestrationRunner : IOrchestrationRunner
{
    private static readonly List<OrchestrationState> FinalStates = [
        OrchestrationState.Completed,
        OrchestrationState.CompensationCompleted,
        OrchestrationState.CompensationFailed
    ];

    public async Task<Either<Exception, Unit>> RunAsync<TData>(IOrchestrator<TData> orchestrator, OrchestratorState<TData> state) where TData : new()
    {
        // re-run compensation
        if (state.State == OrchestrationState.CompensationFailed)
        {
            state.State = OrchestrationState.Failed;
        }

        Exception? runException = null;
        Exception? compensationException = null;

        // while succes or failed during compensation
        while (!FinalStates.Contains(state.State))
        {
            switch (state.State)
            {
                case OrchestrationState.New:
                case OrchestrationState.Running:
                    {
                        var result = await HandleExecuteAsync(orchestrator, state);
                        result.IfLeft(exc => runException = exc);
                        break;
                    }
                case OrchestrationState.Failed:
                    {
                        var result = await HandleCompensationAsync(orchestrator, state);
                        result.IfLeft(exc => compensationException = exc);
                        break;
                    }
                default:
                    throw new InvalidOperationException($"Invalid state: {state.State}");
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

    private static async Task<Either<Exception, Unit>> HandleExecuteAsync<TData>(IOrchestrator<TData> orchestrator, OrchestratorState<TData> state) where TData : new()
    {
        state.State = OrchestrationState.Running;
        var lastStep = state.LastStep;
        var stepsToExecute = lastStep == null
            ? orchestrator.Steps
            : orchestrator.Steps.SkipWhile(steps => steps.Name != lastStep).Skip(1);

        var result = await ExecuteOrchestrationStepsAsync(
            stepsToExecute,
            (step, data) => step
                .ExecuteAsync(data)
                .Do(x => state.LastStep = step.Name),
            state
        );
        result.Match(
            _ => state.State = OrchestrationState.Completed,
            _ => state.State = OrchestrationState.Failed
        );

        return result;
    }

    private static async Task<Either<Exception, Unit>> HandleCompensationAsync<TData>(IOrchestrator<TData> orchestrator, OrchestratorState<TData> state) where TData : new()
    {
        var lastStep = state.LastCompensatedStep ?? state.LastStep; // TODO: write better test for that edge case
        var stepsToCompensate = lastStep == null
            ? []
            : orchestrator.Steps.Reverse().SkipWhile(steps => steps.Name != lastStep);

        var result = await ExecuteOrchestrationStepsAsync(
            stepsToCompensate,
            (step, data) => step
                .CompensateAsync(data)
                .Do(x => state.LastCompensatedStep = step.Name),
            state
        );
        result.Match(
            _ => state.State = OrchestrationState.CompensationCompleted,
            _ => state.State = OrchestrationState.CompensationFailed
        );

        return result;
    }

    private static async Task<Either<Exception, Unit>> ExecuteOrchestrationStepsAsync<TData>(
        IEnumerable<IOrchestratorStep<TData>> steps,
        Func<IOrchestratorStep<TData>, TData, EitherAsync<Exception, Unit>> run,
        OrchestratorState<TData> state
    ) where TData : new()
    {
        foreach (var step in steps)
        {
            try
            {
                var result = await run(step, state.Data);
                if (result.IsLeft)
                {
                    return result;
                }
            }
            catch (Exception exc)
            {
                return exc;
            }

            // probably i should save after each step
            // todo: add _stateRepository.SaveAsync(state);
        }

        return Unit.Default;
    }
}
