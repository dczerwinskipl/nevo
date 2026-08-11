using NEvo.Messaging.Context;

namespace NEvo.Ddd.EventSourcing.Executing;

/// <summary>
/// The default aggregate-aware authorization used when no command-specific policy is
/// supplied; it allows execution. DI infrastructure, not a public dependency —
/// <see cref="IAggregateAuthorization{TCommand,TAggregate,TId}"/> is the extension
/// point consumers build against.
/// </summary>
internal sealed class AllowAllAggregateAuthorization<TCommand, TAggregate, TId> : IAggregateAuthorization<TCommand, TAggregate, TId>
    where TCommand : Command, IAggregateCommand<TAggregate, TId>
    where TAggregate : IAggregateRoot<TId>
    where TId : notnull
{
    public EitherAsync<Exception, Unit> AuthorizeAsync(TCommand command, Option<TAggregate> aggregate, IMessageContext context, CancellationToken cancellationToken)
        => Unit.Default;
}
