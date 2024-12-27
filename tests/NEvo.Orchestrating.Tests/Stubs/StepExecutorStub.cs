using LanguageExt;

namespace NEvo.Orchestrating.Tests.Stubs;

public class StepExecutorStub : StepExecutor
{
    internal readonly List<string> ExecutedSteps = [];
    internal readonly List<string> CompensatedSteps = [];

    public override Task<Either<Exception, Unit>> ExecuteAsync<TData>(IOrchestratorStep<TData> step, OrchestratorState<TData> state, CancellationToken cancellationToken)
    {
        ExecutedSteps.Add(step.Name);
        return base.ExecuteAsync(step, state, cancellationToken);
    }

    public override Task<Either<Exception, Unit>> CompensateAsync<TData>(IOrchestratorStep<TData> step, OrchestratorState<TData> state, CancellationToken cancellationToken)
    {
        CompensatedSteps.Add(step.Name);
        return base.CompensateAsync(step, state, cancellationToken);
    }
}
