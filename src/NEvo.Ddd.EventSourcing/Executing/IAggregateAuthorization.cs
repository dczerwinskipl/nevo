using NEvo.Messaging.Context;

namespace NEvo.Ddd.EventSourcing.Executing;

/// <summary>
/// Authorizes a command against the currently loaded aggregate state. Invoked after
/// rehydration and before the domain decision, receiving the current state as
/// <see cref="Option{T}"/> — <c>Some</c> for an existing aggregate, <c>None</c> on the
/// creation path — so a policy that only makes sense for existing resources can
/// explicitly reject or ignore <c>None</c> according to its own use case rather than the
/// hook being silently skipped. Returning <c>Left</c> denies execution before any event
/// is produced or appended.
/// </summary>
public interface IAggregateAuthorization<TCommand, TAggregate, TId>
    where TCommand : Command, IAggregateCommand<TAggregate, TId>
    where TAggregate : IAggregateRoot<TId>
    where TId : notnull
{
    EitherAsync<Exception, Unit> AuthorizeAsync(TCommand command, Option<TAggregate> aggregate, IMessageContext context, CancellationToken cancellationToken);
}
