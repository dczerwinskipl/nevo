namespace NEvo.Ddd.EventSourcing.Handling;

/// <summary>
/// Level 2 (D1): an explicit Event Sourced handler for commands that need orchestration
/// (I/O, injected dependencies) but should still use the framework-managed ES lifecycle
/// — routed through the same shared executor Level 1 is, so load/authorize/append/
/// publish is never duplicated. Receives the current state as <see cref="Option{T}"/> —
/// <c>Some</c> when an existing stream/aggregate was rehydrated, <c>None</c> on the
/// creation path — never a bare <typeparamref name="TAggregate"/>, never <c>null</c>
/// (D24). May inject any orchestration dependency via its own constructor, and may
/// delegate to Level 1's own decision-method discovery (inject
/// <c>Deciding.IDecider</c> and call <c>DecideAsync</c>) instead of duplicating an
/// aggregate's transition logic (D1). Manages exactly one Event Sourced write target
/// per command — this type's own shape offers no way to write a second,
/// independently-versioned stream in the same invocation (D31).
/// </summary>
public interface IEventSourcedCommandHandler<TCommand, TAggregate, TId>
    where TCommand : Command, IAggregateCommand<TAggregate, TId>
    where TAggregate : IAggregateRoot<TId>
    where TId : notnull
{
    EitherAsync<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> HandleAsync(TCommand command, Option<TAggregate> aggregate, CancellationToken cancellationToken);
}
