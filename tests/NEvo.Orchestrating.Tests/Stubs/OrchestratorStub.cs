using LanguageExt;

using static LanguageExt.Prelude;

namespace NEvo.Orchestrating.Tests.Stubs;

public record OrchestratorStubData();



public class OrchestratorStub() : IOrchestrator<OrchestratorStubData>
{
    private readonly List<IOrchestratorStep<OrchestratorStubData>> _steps = [];
    public IEnumerable<IOrchestratorStep<OrchestratorStubData>> Steps => _steps;

    internal readonly List<string> ExecutedSteps = [];
    internal readonly List<string> CompensatedSteps = [];

    public void AddStep(string name, bool successExecution, bool successCompensation = true)
    {
        _steps.Add(new OrchestratorStepStub(this, name, successExecution, successCompensation));
    }

    internal class OrchestratorStepStub(
        OrchestratorStub orchestratorStub,
        string name,
        bool successExecution = true,
        bool successCompensation = true
    ) : IOrchestratorStep<OrchestratorStubData>
    {
        private readonly OrchestratorStub _orchestratorStub = orchestratorStub;
        public string Name { get; } = name;

        public EitherAsync<Exception, Unit> CompensateAsync(OrchestratorStubData data)
        {
            _orchestratorStub.CompensatedSteps.Add(Name);
            return successCompensation ?
                RightAsync<Exception, Unit>(Unit.Default) :
                LeftAsync<Exception, Unit>(new Exception("Failed to compensate"));
        }

        public EitherAsync<Exception, Unit> ExecuteAsync(OrchestratorStubData data)
        {
            _orchestratorStub.ExecutedSteps.Add(Name);
            return successExecution ?
                RightAsync<Exception, Unit>(Unit.Default) :
                LeftAsync<Exception, Unit>(new Exception("Failed to compensate"));
        }
    }
}
