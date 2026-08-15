using NEvo.Ddd.EventSourcing.Executing;
using NEvo.Messaging.Context;

namespace NEvo.Ddd.EventSourcing.Deciding;

public class DeciderCommandHandler<TCommand, TAggregate, TId>(
    IDeciderRegistry deciderRegistry,
    IEventSourcedCommandExecutor executor,
    IAggregateAuthorization<TCommand, TAggregate, TId> authorization
)
    where TCommand : Command, IAggregateCommand<TAggregate, TId>
    where TAggregate : IAggregateRoot<TId>
    where TId : notnull
{
    private readonly IDeciderRegistry _deciderRegistry = deciderRegistry;
    private readonly IEventSourcedCommandExecutor _executor = executor;
    private readonly IAggregateAuthorization<TCommand, TAggregate, TId> _authorization = authorization;

    public EitherAsync<Exception, Unit> HandleAsync(TCommand command, IMessageContext context, CancellationToken cancellationToken)
        => GetDecider(command).Bind(decider =>
            _executor.ExecuteAsync<TCommand, TAggregate, TId>(
                command,
                context,
                _authorization,
                state => decider.DecideAsync(state, command, cancellationToken),
                cancellationToken
            )
        );

    private EitherAsync<Exception, IDecider> GetDecider(TCommand command)
            => _deciderRegistry
                .GetDecider<TCommand, TAggregate, TId>(command)
                .ToEitherAsync(() => new Exception($"No decider found for command {command.GetType().Name}"));
}
