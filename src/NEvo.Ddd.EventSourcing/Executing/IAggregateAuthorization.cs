using NEvo.Messaging.Context;

namespace NEvo.Ddd.EventSourcing.Executing;

/// <summary>
/// The one aggregate-aware authorization hook point (D5, D24-D25): invoked by the
/// executor after rehydration, before the decision. Receives the current state as
/// <see cref="Option{T}"/> — <c>Some</c> when an aggregate was rehydrated, <c>None</c>
/// on the creation path — so a policy that only makes sense for existing resources can
/// explicitly reject/ignore <c>None</c> according to its own use case; nothing here
/// silently skips this hook merely because there is no aggregate yet. Real policy logic
/// is task 07's concern — this task only defines where the call happens and what it
/// receives.
/// </summary>
public interface IAggregateAuthorization<TCommand, TAggregate, TId>
    where TCommand : Command, IAggregateCommand<TAggregate, TId>
    where TAggregate : IAggregateRoot<TId>
    where TId : notnull
{
    EitherAsync<Exception, Unit> AuthorizeAsync(TCommand command, Option<TAggregate> aggregate, IMessageContext context, CancellationToken cancellationToken);
}
