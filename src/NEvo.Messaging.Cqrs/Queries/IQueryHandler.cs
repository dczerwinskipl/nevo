using NEvo.Messaging.Context;

namespace NEvo.Messaging.Cqrs.Queries;

public interface IQueryHandler<in TQuery, TResult> where TQuery : Query<TResult>
{
    Task<Either<Exception, TResult>> HandleAsync(TQuery query, IMessageContext messageContext, CancellationToken cancellationToken);
}
