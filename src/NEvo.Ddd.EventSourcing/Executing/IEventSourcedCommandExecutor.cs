using NEvo.Messaging.Context;

namespace NEvo.Ddd.EventSourcing.Executing;

/// <summary>
/// The shared load → authorize → decide → append → publish lifecycle used by both the
/// aggregate-method convention and an explicit Event Sourced handler — neither
/// duplicates this logic. Independent of aggregate-method reflection/discovery: it
/// depends only on a supplied <paramref name="decide"/> operation, and nothing in its
/// shape requires that operation to be produced by an instance method on an immutable
/// aggregate-state object.
/// </summary>
public interface IEventSourcedCommandExecutor
{
    /// <summary>
    /// <paramref name="decide"/> receives the current state as <see cref="Option{T}"/>
    /// and produces the events to append. The executor maps <c>None</c> to
    /// <see cref="ExpectedStreamState.NoStream"/> (a new stream is expected) and a
    /// loaded <c>Some</c> to <see cref="ExpectedStreamState.Exact"/> (an exact-version
    /// optimistic-concurrency append) — the caller never constructs either value itself.
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
