using System;
using LanguageExt;

namespace NEvo.Orchestrating;

public interface IOrchestratorStateRepository
{
    public Task<Either<Exception, T>> LockAsync<T>(
        T state,
        CancellationToken cancellationToken
    ) where T : OrchestratorState;

    public Task<Either<Exception, T>> SaveAsync<T>(
        T state,
        CancellationToken cancellationToken
    ) where T : OrchestratorState;

    public Task<Either<Exception, OrchestratorState>> GetAsync(
        Guid orchestrationId,
        CancellationToken cancellationToken
    );
}
