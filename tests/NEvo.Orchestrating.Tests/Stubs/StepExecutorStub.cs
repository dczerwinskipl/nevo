using LanguageExt;

namespace NEvo.Orchestrating.Tests.Stubs;

public class StepExecutorStub : StepExecutor
{
    internal readonly List<string> ExecutedSteps = [];
    internal readonly List<string> CompensatedSteps = [];

    public override async Task<Either<Exception, OrchestratorState<TData>>> ExecuteAsync<TData>(
        IOrchestratorStep<TData> step,
        OrchestratorState<TData> state,
        CancellationToken cancellationToken
    )
    {
        ExecutedSteps.Add(step.Name);
        return await base.ExecuteAsync(step, state, cancellationToken);
    }

    public override async Task<Either<Exception, OrchestratorState<TData>>> CompensateAsync<TData>(
        IOrchestratorStep<TData> step,
        OrchestratorState<TData> state,
        CancellationToken cancellationToken
    )
    {
        CompensatedSteps.Add(step.Name);
        return await base.CompensateAsync(step, state, cancellationToken);
    }
}
