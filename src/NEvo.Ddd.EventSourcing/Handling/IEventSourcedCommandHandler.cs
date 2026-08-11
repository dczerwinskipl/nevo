namespace NEvo.Ddd.EventSourcing.Handling;

/// <summary>
/// The explicit Event Sourced handler extension point, for a command that needs
/// application orchestration (I/O, injected dependencies) while still using the
/// framework-managed Event Sourcing lifecycle — load, authorize, append, and publish
/// are handled for it. Receives the current state as <see cref="Option{T}"/>:
/// <c>Some</c> when an existing stream/aggregate was rehydrated, <c>None</c> on the
/// creation path — never a bare <typeparamref name="TAggregate"/>, never <c>null</c>.
/// May inject any orchestration dependency via its own constructor, and may delegate to
/// the aggregate-method convention's own decision resolution (inject
/// <c>Deciding.IDecider</c> and call <c>DecideAsync</c>) instead of duplicating an
/// aggregate's transition logic. Manages exactly one Event Sourced write target per
/// command — this type's own shape offers no way to write a second,
/// independently-versioned stream in the same invocation.
/// </summary>
public interface IEventSourcedCommandHandler<TCommand, TAggregate, TId>
    where TCommand : Command, IAggregateCommand<TAggregate, TId>
    where TAggregate : IAggregateRoot<TId>
    where TId : notnull
{
    EitherAsync<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> HandleAsync(TCommand command, Option<TAggregate> aggregate, CancellationToken cancellationToken);
}
