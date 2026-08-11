using Microsoft.Extensions.DependencyInjection;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Messaging.Handling;

namespace NEvo.Ddd.EventSourcing.Handling;

public class DeciderCommandHandlerProvider(IServiceProvider serviceProvider, IDeciderRegistry deciderRegistry) : IMessageHandlerProvider
{
    private readonly IServiceProvider _serviceProvider = serviceProvider;
    private readonly IDeciderRegistry _deciderRegistry = deciderRegistry;

    public IDictionary<Type, IEnumerable<IMessageHandler>> GetMessageHandlers()
        => _deciderRegistry.GetDeciderDesciptions()
            // One route per (command, aggregate, id) triple: AggregateDecider can
            // report several descriptions for the same route — one per concrete state
            // type that declares a decision method for this command — but they all
            // resolve through the same DeciderCommandHandlerAdapter, which asks the
            // decider registry to pick the applicable state-specific method at
            // execution time. Registering one adapter per description here would
            // produce several competing Fallback candidates for what is really a
            // single convention route.
            .GroupBy(d => (d.CommandType, d.AggregateType, d.IdType))
            .Select(route =>
            {
                var (commandType, aggregateType, idType) = route.Key;
                var handlerType = typeof(DeciderCommandHandlerAdapter<,,>).MakeGenericType(commandType, aggregateType, idType);
                var handlerDescription = new MessageHandlerDescription(
                    $"{aggregateType.Name}-{commandType.Name}",
                    handlerType,
                    commandType,
                    InterfaceType: null,
                    typeof(Unit)
                )
                { Role = HandlerRole.Fallback };
                var handler = (IMessageHandler)ActivatorUtilities.CreateInstance(_serviceProvider, handlerType, handlerDescription)!;
                return new { commandType, Handler = handler };
            })
            .GroupBy(x => x.commandType)
            .ToDictionary(
                x => x.Key,
                x => x.Select(y => y.Handler)
            );
}
