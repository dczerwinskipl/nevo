namespace NEvo.Messaging.Cqrs.Queries;

public interface IQueryDispatcher
{
    Task<Either<Exception, TResult>> DispatchAsync<TResult>(Query<TResult> query, CancellationToken cancellationToken);
}
