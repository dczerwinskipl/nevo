using NEvo.Messaging.Context;

namespace NEvo.Ddd.EventSourcing.Executing;

/// <summary>
/// The shared load → authorize → decide → append → publish lifecycle (D1) used by both
/// the aggregate-method convention (Level 1) and the explicit Event Sourced handler
/// (Level 2, task 04) — neither duplicates this logic. Convention-agnostic (D30): it
/// depends on a supplied <paramref name="decide"/> operation rather than performing any
/// reflection/state-method discovery itself, and nothing in its shape requires that
/// operation to be produced by an instance method on an immutable aggregate-state
/// object (D17).
/// </summary>
public interface IEventSourcedCommandExecutor
{
    /// <summary>
    /// <paramref name="decide"/> receives the current state as <see cref="Option{T}"/>
    /// (D24) and produces the events to append. The executor maps <c>None</c> to
    /// <see cref="ExpectedStreamState.NoStream"/> and a loaded <c>Some</c> to
    /// <see cref="ExpectedStreamState.Exact"/> (D29) — the caller never constructs
    /// either value itself.
    /// </summary>
    EitherAsync<Exception, Unit> ExecuteAsync<TCommand, TAggregate, TId>(
        TCommand command,
        IMessageContext context,
        IAggregateAuthorization<TCommand, TAggregate, TId> authorization,
        Func<Option<TAggregate>, EitherAsync<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>>> decide,
        CancellationToken cancellationToken)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;
}
