using System.Runtime.CompilerServices;
using System.Security.Cryptography;

namespace NEvo.Ddd.EventSourcing.Deciding;

public class DeciderCommandHandler<TCommand, TAggregate, TId>(
    IDeciderRegistry deciderRegistry,
    IEventStore eventStore
)
    where TCommand : Command, IAggregateCommand<TAggregate, TId>
    where TAggregate : IAggregateRoot<TId, TAggregate>
    where TId : notnull
{
    public EitherAsync<Exception, Unit> HandleAsync(TCommand command, CancellationToken cancellationToken)
        => GetDecider(command).BindAsync(decider =>
                eventStore
                    .LoadAggregateAsync<TAggregate, TId>(command.StreamId, cancellationToken)
                    .Match(
                        Some: aggregate =>
                            decider
                                .DecideAsync(Option<TAggregate>.Some(aggregate), command, cancellationToken)
                                .Bind(events => eventStore.AppendEventsAsync(aggregate.Id, events, cancellationToken)),

                        None: () =>
                            decider
                                .DecideAsync(Option<TAggregate>.None, command, cancellationToken)
                                .Bind(events => eventStore.AppendEventsAsync(command.StreamId, events, cancellationToken))
                    )
            );

    private EitherAsync<Exception, IDecider> GetDecider(TCommand command)
            => deciderRegistry
                .GetDecider<TCommand, TAggregate, TId>(command)
                .ToEitherAsync(() => new Exception($"No decider found for command {command.GetType().Name}"));
}

