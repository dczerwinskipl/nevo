using System.Transactions;
using LanguageExt;
using NEvo.Core;

namespace NEvo.Orchestrating;

public class PersistentStepExecutor(
    IStepExecutor stepExecutor,
    IOrchestratorStateRepository stateRepository
    ) : IStepExecutor
{
    private readonly IStepExecutor _innerStepExecutor = Check.Null(stepExecutor);
    private readonly IOrchestratorStateRepository _stateRepository = Check.Null(stateRepository);

    public Task<Either<Exception, OrchestratorState<TData>>> ExecuteAsync<TData>(
        IOrchestratorStep<TData> step,
        OrchestratorState<TData> state,
        CancellationToken cancellationToken
    ) where TData : new()
        => WithPersistence(
            state,
            (state, cancellationToken) => _innerStepExecutor.ExecuteAsync(step, state, cancellationToken),
            cancellationToken
        );

    public Task<Either<Exception, OrchestratorState<TData>>> CompensateAsync<TData>(
        IOrchestratorStep<TData> step,
        OrchestratorState<TData> state,
        CancellationToken cancellationToken
    ) where TData : new()
        => WithPersistence(
            state,
            (state, cancellationToken) => _innerStepExecutor.CompensateAsync(step, state, cancellationToken),
            cancellationToken
        );

    private async Task<Either<Exception, OrchestratorState<TData>>> WithPersistence<TData>(
        OrchestratorState<TData> state,
        Func<OrchestratorState<TData>, CancellationToken, Task<Either<Exception, OrchestratorState<TData>>>> handle,
        CancellationToken cancellationToken
    ) where TData : new()
    {
        using var transaction = new TransactionScope(TransactionScopeAsyncFlowOption.Enabled);

        var finalState = await _stateRepository
                .LockAsync(state, cancellationToken)
                .BindAsync(state => handle(state, cancellationToken))
                .BindAsync(state => _stateRepository.SaveAsync(state, cancellationToken));

        // we should commit also partial state, we want to keep it in case of restarting
        transaction.Complete();

        return finalState;
    }
}