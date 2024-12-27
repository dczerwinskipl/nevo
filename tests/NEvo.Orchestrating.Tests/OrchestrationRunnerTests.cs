using NEvo.Orchestrating.Tests.Stubs;
using Xunit;

namespace NEvo.Orchestrating.Tests;

public class OrchestrationRunnerTests
{
    private readonly StepExecutorStub _stepExecutor = new();

    [Fact]
    public async Task RunAsync_ShouldExecuteAllSteps()
    {
        // arrange
        var orchestrator = new OrchestratorStub();
        orchestrator.AddStep("Step1", true);
        orchestrator.AddStep("Step2", true);
        orchestrator.AddStep("Step3", true);

        var orchestratorState = new OrchestratorState<OrchestratorStubData>
        {
            OrchestratorType = typeof(OrchestratorStub).AssemblyQualifiedName!,
            Status = OrchestratorStatus.New,
            Data = new OrchestratorStubData()
        };

        var runner = new OrchestrationRunner(_stepExecutor);

        // act
        await runner.RunAsync(orchestrator, orchestratorState, default);

        // assert
        orchestratorState.Status.Should().Be(OrchestratorStatus.Completed);
        orchestratorState.LastStep.Should().Be("Step3");
        _stepExecutor.ExecutedSteps.Should().HaveCount(3);
        _stepExecutor.CompensatedSteps.Should().BeEmpty();
    }

    [Fact]
    public async Task RunAsync_ShouldExecuteAndCompensateAllExecutedSteps()
    {
        // arrange
        var orchestrator = new OrchestratorStub();
        orchestrator.AddStep("Step1", true);
        orchestrator.AddStep("Step2", true);
        orchestrator.AddStep("Step3", false);

        var orchestratorState = new OrchestratorState<OrchestratorStubData>
        {
            OrchestratorType = typeof(OrchestratorStub).AssemblyQualifiedName!,
            Status = OrchestratorStatus.New,
            Data = new OrchestratorStubData()
        };

        var runner = new OrchestrationRunner(_stepExecutor);

        // act
        await runner.RunAsync(orchestrator, orchestratorState, default);

        // assert
        orchestratorState.Status.Should().Be(OrchestratorStatus.CompensationCompleted);
        orchestratorState.LastStep.Should().Be("Step2");
        orchestratorState.LastCompensatedStep.Should().Be("Step1");
        _stepExecutor.ExecutedSteps.Should().BeEquivalentTo("Step1", "Step2", "Step3");
        _stepExecutor.CompensatedSteps.Should().BeEquivalentTo("Step2", "Step1");
    }

    [Fact]
    public async Task RunAsync_WhenCompensationsFailed_ShouldFinishedInCompensationFailedState()
    {
        // arrange
        var orchestrator = new OrchestratorStub();
        orchestrator.AddStep("Step1", true, successCompensation: false);
        orchestrator.AddStep("Step2", true);
        orchestrator.AddStep("Step3", false);

        var orchestratorState = new OrchestratorState<OrchestratorStubData>
        {
            OrchestratorType = typeof(OrchestratorStub).AssemblyQualifiedName!,
            Status = OrchestratorStatus.New,
            Data = new OrchestratorStubData()
        };

        var runner = new OrchestrationRunner(_stepExecutor);

        // act
        await runner.RunAsync(orchestrator, orchestratorState, default);

        // assert
        orchestratorState.Status.Should().Be(OrchestratorStatus.CompensationFailed);
        orchestratorState.LastStep.Should().Be("Step2");
        orchestratorState.LastCompensatedStep.Should().Be("Step2");
        _stepExecutor.ExecutedSteps.Should().BeEquivalentTo("Step1", "Step2", "Step3");
        _stepExecutor.CompensatedSteps.Should().BeEquivalentTo("Step2", "Step1");
    }

    [Fact]
    public async Task RunAsync_WhenInitStateIsFailed_ShouldOnlyCompenstateExecutedActions()
    {
        // arrange
        var orchestrator = new OrchestratorStub();
        orchestrator.AddStep("Step1", true);
        orchestrator.AddStep("Step2", true);
        orchestrator.AddStep("Step3", false);

        var orchestratorState = new OrchestratorState<OrchestratorStubData>
        {
            OrchestratorType = typeof(OrchestratorStub).AssemblyQualifiedName!,
            Status = OrchestratorStatus.Failed,
            LastStep = "Step2",
            Data = new OrchestratorStubData()
        };

        var runner = new OrchestrationRunner(_stepExecutor);

        // act
        await runner.RunAsync(orchestrator, orchestratorState, default);

        // assert
        orchestratorState.Status.Should().Be(OrchestratorStatus.CompensationCompleted);
        orchestratorState.LastStep.Should().Be("Step2");
        orchestratorState.LastCompensatedStep.Should().Be("Step1");
        _stepExecutor.ExecutedSteps.Should().BeEmpty();
        _stepExecutor.CompensatedSteps.Should().BeEquivalentTo("Step2", "Step1");
    }

    [Fact]
    public async Task RunAsync_WhenInitStateIsCompensationFailed_ShouldOnlyCompenstateRemainingActions()
    {
        // arrange
        var orchestrator = new OrchestratorStub();
        orchestrator.AddStep("Step1", true);
        orchestrator.AddStep("Step2", true);
        orchestrator.AddStep("Step3", false);

        var orchestratorState = new OrchestratorState<OrchestratorStubData>
        {
            OrchestratorType = typeof(OrchestratorStub).AssemblyQualifiedName!,
            Status = OrchestratorStatus.CompensationFailed,
            LastStep = "Step2",
            LastCompensatedStep = "Step1",
            Data = new OrchestratorStubData()
        };

        var runner = new OrchestrationRunner(_stepExecutor);

        // act
        await runner.RunAsync(orchestrator, orchestratorState, default);

        // assert
        orchestratorState.Status.Should().Be(OrchestratorStatus.CompensationCompleted);
        orchestratorState.LastStep.Should().Be("Step2");
        orchestratorState.LastCompensatedStep.Should().Be("Step1");
        _stepExecutor.ExecutedSteps.Should().BeEmpty();
        _stepExecutor.CompensatedSteps.Should().BeEquivalentTo("Step1");
    }
}
