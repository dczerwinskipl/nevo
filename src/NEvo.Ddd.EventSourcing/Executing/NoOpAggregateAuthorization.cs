using NEvo.Messaging.Context;

namespace NEvo.Ddd.EventSourcing.Executing;

/// <summary>
/// Default aggregate-aware authorization: allows everything. Registered so Level 1/
/// Level 2 execution works before task 07 adds real policy logic; task 07 replaces this
/// registration for commands that need one.
/// </summary>
public class NoOpAggregateAuthorization<TCommand, TAggregate, TId> : IAggregateAuthorization<TCommand, TAggregate, TId>
    where TCommand : Command, IAggregateCommand<TAggregate, TId>
    where TAggregate : IAggregateRoot<TId>
    where TId : notnull
{
    public EitherAsync<Exception, Unit> AuthorizeAsync(TCommand command, Option<TAggregate> aggregate, IMessageContext context, CancellationToken cancellationToken)
        => Unit.Default;
}
