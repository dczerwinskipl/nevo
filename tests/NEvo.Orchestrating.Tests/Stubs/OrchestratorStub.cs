using LanguageExt;

using static LanguageExt.Prelude;

namespace NEvo.Orchestrating.Tests.Stubs;

public class OrchestratorStub() : IOrchestrator<OrchestratorStubData>
{
    private readonly List<IOrchestratorStep<OrchestratorStubData>> _steps = [];
    public IEnumerable<IOrchestratorStep<OrchestratorStubData>> Steps => _steps;

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

        public async Task<Either<Exception, Unit>> CompensateAsync(OrchestratorStubData data, CancellationToken cancellationToken)
        {
            return successCompensation ?
                Right<Exception, Unit>(Unit.Default) :
                Left<Exception, Unit>(new Exception("Failed to compensate"));
        }

        public async Task<Either<Exception, Unit>> ExecuteAsync(OrchestratorStubData data, CancellationToken cancellationToken)
        {
            return successExecution ?
                Right<Exception, Unit>(Unit.Default) :
                Left<Exception, Unit>(new Exception("Failed to compensate"));
        }
    }
}
