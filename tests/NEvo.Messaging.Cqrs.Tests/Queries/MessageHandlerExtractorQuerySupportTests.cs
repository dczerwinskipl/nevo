using LanguageExt;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NEvo.Messaging.Context;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Cqrs.Queries;
using NEvo.Messaging.Events;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Cqrs.Tests.Queries;

public class MessageHandlerExtractorQuerySupportTests
{
    [Fact]
    public void GetMessageHandlers_DiscoversCommandEventAndQueryHandlers_WithNoExtractorChange()
    {
        // Arrange
        var logger = Mock.Of<ILogger<MessageHandlerAdapter>>();
        IMessageHandlerFactory[] factories =
        [
            new CommandHandlerAdapterFactory(logger),
            new EventHandlerAdapterFactory(logger),
            new QueryHandlerAdapterFactory(logger),
        ];
        var configuration = new MessageHandlerExtractorConfiguration();
        configuration.Handlers.Add(typeof(CommandHandlerMock));
        configuration.Handlers.Add(typeof(EventHandlerMock));
        configuration.Handlers.Add(typeof(QueryHandlerMock));
        var extractor = new MessageHandlerExtractor(factories, Options.Create(configuration));

        // Act
        var handlers = extractor.GetMessageHandlers();

        // Assert
        handlers.Should().ContainKey(typeof(CommandMock));
        handlers.Should().ContainKey(typeof(EventMock));
        handlers.Should().ContainKey(typeof(QueryMock));
        handlers[typeof(QueryMock)].Should().ContainSingle()
            .Which.HandlerDescription.ReturnType.Should().Be(typeof(string));
    }

    private record CommandMock : Command;
    private record EventMock : Event;
    private record QueryMock : Query<string>;

    private class CommandHandlerMock : ICommandHandler<CommandMock>
    {
        public Task<Either<Exception, Unit>> HandleAsync(CommandMock message, IMessageContext messageContext, CancellationToken cancellationToken)
            => throw new NotImplementedException();
    }

    private class EventHandlerMock : IEventHandler<EventMock>
    {
        public Task<Either<Exception, Unit>> HandleAsync(EventMock message, IMessageContext messageContext, CancellationToken cancellationToken)
            => throw new NotImplementedException();
    }

    private class QueryHandlerMock : IQueryHandler<QueryMock, string>
    {
        public Task<Either<Exception, string>> HandleAsync(QueryMock query, IMessageContext messageContext, CancellationToken cancellationToken)
            => throw new NotImplementedException();
    }
}
