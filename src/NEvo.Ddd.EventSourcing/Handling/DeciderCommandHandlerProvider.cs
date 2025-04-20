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
            .Select(d =>
            {
                var handlerType = typeof(DeciderCommandHandlerAdapter<,,>).MakeGenericType(d.CommandType, d.AggregateType, d.IdType);
                var handlerDescription = new MessageHandlerDescription(
                    d.ToString(),
                    handlerType,
                    d.CommandType,
                    null!, // interface?
                    typeof(Unit)
                );
                var handler = (IMessageHandler)ActivatorUtilities.CreateInstance(_serviceProvider, handlerType, handlerDescription)!;
                return new { d.CommandType, Handler = handler };
            })
            .GroupBy(x => x.CommandType)
            .ToDictionary(
                x => x.Key,
                x => x.Select(y => y.Handler)
            );
}
