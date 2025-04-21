namespace NEvo.Ddd.EventSourcing.Deciding;

public class DeciderCommandHandler<TCommand, TAggregate, TId>(
    IDeciderRegistry deciderRegistry,
    IAggregateRepository repository
)
    where TCommand : Command, IAggregateCommand<TAggregate, TId>
    where TAggregate : IAggregateRoot<TId>
    where TId : notnull
{
    private readonly IDeciderRegistry _deciderRegistry = deciderRegistry;
    private readonly IAggregateRepository _repository = repository;

    public EitherAsync<Exception, Unit> HandleAsync(TCommand command, CancellationToken cancellationToken)
        => GetDecider(command).BindAsync(decider =>
                _repository
                    .LoadAggregateAsync<TAggregate, TId>(command.StreamId, cancellationToken)
                    .Match(
                        Some: (loaded) =>
                            decider
                                .DecideAsync(Option<TAggregate>.Some(loaded.Aggregate), command, cancellationToken)
                                .Bind(events => _repository.AppendEventsAsync(loaded.Aggregate.Id, events, loaded.Version, cancellationToken)),

                        None: () =>
                            decider
                                .DecideAsync(Option<TAggregate>.None, command, cancellationToken)
                                .Bind(events => _repository.AppendEventsAsync(command.StreamId, events, 0, cancellationToken))
                    )
            );

    private EitherAsync<Exception, IDecider> GetDecider(TCommand command)
            => _deciderRegistry
                .GetDecider<TCommand, TAggregate, TId>(command)
                .ToEitherAsync(() => new Exception($"No decider found for command {command.GetType().Name}"));
}

