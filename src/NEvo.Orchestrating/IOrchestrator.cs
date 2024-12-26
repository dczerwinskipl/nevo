namespace NEvo.Orchestrating;

public interface IOrchestrator<TData> where TData : new()
{
    public IEnumerable<IOrchestratorStep<TData>> Steps { get; }
}
