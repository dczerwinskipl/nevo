using LanguageExt;

namespace NEvo.Orchestrating;

public interface IOrchestratorStep<TData>
{
    public string Name { get; }
    public Task<Either<Exception, Unit>> ExecuteAsync(TData data, CancellationToken cancellationToken);
    public Task<Either<Exception, Unit>> CompensateAsync(TData data, CancellationToken cancellationToken);
}