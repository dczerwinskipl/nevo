using NEvo.Orchestrating.Tests.Stubs;
using Xunit;

namespace NEvo.Orchestrating.Tests;

public class OrchestrationRunnerTests
{
    private readonly OrchestrationRunner _runner = new();

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
            State = OrchestrationState.New,
            Data = new OrchestratorStubData()
        };

        // act
        await _runner.RunAsync(orchestrator, orchestratorState);

        // assert
        orchestratorState.State.Should().Be(OrchestrationState.Completed);
        orchestratorState.LastStep.Should().Be("Step3");
        orchestrator.ExecutedSteps.Should().HaveCount(3);
        orchestrator.CompensatedSteps.Should().BeEmpty();
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
            State = OrchestrationState.New,
            Data = new OrchestratorStubData()
        };

        // act
        await _runner.RunAsync(orchestrator, orchestratorState);

        // assert
        orchestratorState.State.Should().Be(OrchestrationState.CompensationCompleted);
        orchestratorState.LastStep.Should().Be("Step2");
        orchestratorState.LastCompensatedStep.Should().Be("Step1");
        orchestrator.ExecutedSteps.Should().BeEquivalentTo("Step1", "Step2", "Step3");
        orchestrator.CompensatedSteps.Should().BeEquivalentTo("Step2", "Step1");
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
            State = OrchestrationState.New,
            Data = new OrchestratorStubData()
        };

        // act
        await _runner.RunAsync(orchestrator, orchestratorState);

        // assert
        orchestratorState.State.Should().Be(OrchestrationState.CompensationFailed);
        orchestratorState.LastStep.Should().Be("Step2");
        orchestratorState.LastCompensatedStep.Should().Be("Step2");
        orchestrator.ExecutedSteps.Should().BeEquivalentTo("Step1", "Step2", "Step3");
        orchestrator.CompensatedSteps.Should().BeEquivalentTo("Step2", "Step1");
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
            State = OrchestrationState.Failed,
            LastStep = "Step2",
            Data = new OrchestratorStubData()
        };

        // act
        await _runner.RunAsync(orchestrator, orchestratorState);

        // assert
        orchestratorState.State.Should().Be(OrchestrationState.CompensationCompleted);
        orchestratorState.LastStep.Should().Be("Step2");
        orchestratorState.LastCompensatedStep.Should().Be("Step1");
        orchestrator.ExecutedSteps.Should().BeEmpty();
        orchestrator.CompensatedSteps.Should().BeEquivalentTo("Step2", "Step1");
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
            State = OrchestrationState.CompensationFailed,
            LastStep = "Step2",
            LastCompensatedStep = "Step1",
            Data = new OrchestratorStubData()
        };

        // act
        await _runner.RunAsync(orchestrator, orchestratorState);

        // assert
        orchestratorState.State.Should().Be(OrchestrationState.CompensationCompleted);
        orchestratorState.LastStep.Should().Be("Step2");
        orchestratorState.LastCompensatedStep.Should().Be("Step1");
        orchestrator.ExecutedSteps.Should().BeEmpty();
        orchestrator.CompensatedSteps.Should().BeEquivalentTo("Step1");
    }
}
