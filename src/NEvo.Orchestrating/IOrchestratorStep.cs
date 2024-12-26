using LanguageExt;

namespace NEvo.Orchestrating;

public interface IOrchestratorStep<TData>
{
    public string Name { get; }
    public EitherAsync<Exception, Unit> ExecuteAsync(TData data);
    public EitherAsync<Exception, Unit> CompensateAsync(TData data);
}