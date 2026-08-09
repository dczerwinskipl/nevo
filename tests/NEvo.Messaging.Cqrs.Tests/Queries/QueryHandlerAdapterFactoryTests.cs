using LanguageExt;
using Microsoft.Extensions.Logging;
using NEvo.Messaging.Context;
using NEvo.Messaging.Cqrs.Queries;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Cqrs.Tests.Queries;

public class QueryHandlerAdapterFactoryTests
{
    private readonly ILogger<MessageHandlerAdapter> _loggerMock = Mock.Of<ILogger<MessageHandlerAdapter>>();

    [Fact]
    public void ForInterface_ShouldReturnIQueryHandlerGenericType()
    {
        // Arrange
        var factory = new QueryHandlerAdapterFactory(_loggerMock);

        // Act
        var forInterface = factory.ForInterface;

        // Assert
        forInterface.Should().Be(typeof(IQueryHandler<,>));
    }

    [Fact]
    public void Create_ShouldReturnMessageHandlerAdapter()
    {
        // Arrange
        var factory = new QueryHandlerAdapterFactory(_loggerMock);
        var description = new MessageHandlerDescription(
            "Key",
            typeof(StringQueryHandlerMock),
            typeof(StringQueryMock),
            typeof(IQueryHandler<StringQueryMock, string>),
            ReturnType: typeof(string),
            Method: typeof(StringQueryHandlerMock).GetMethod(nameof(StringQueryHandlerMock.HandleAsync))
        );

        // Act
        var handler = factory.Create(description);

        // Assert
        handler.Should().BeOfType<MessageHandlerAdapter>();
    }

    [Fact]
    public void GetMessageHandlerDescriptions_ReflectsActualResultType_ForStringResult()
    {
        // Arrange
        var factory = new QueryHandlerAdapterFactory(_loggerMock);
        Type handlerType = typeof(StringQueryHandlerMock);
        Type handlerInterface = typeof(IQueryHandler<StringQueryMock, string>);

        // Act
        var descriptions = factory.GetMessageHandlerDescriptions(handlerType, handlerInterface).ToList();

        // Assert
        descriptions.Should().HaveCount(1);
        var description = descriptions[0];
        description.Key.Should().Be($"{handlerType.FullName}-{typeof(StringQueryMock).FullName}");
        description.HandlerType.Should().Be(handlerType);
        description.MessageType.Should().Be(typeof(StringQueryMock));
        description.InterfaceType.Should().Be(handlerInterface);
        description.ReturnType.Should().Be(typeof(string));
        description.Method.Should().NotBeNull();
        description.Method!.Name.Should().Be(nameof(StringQueryHandlerMock.HandleAsync));
    }

    [Fact]
    public void GetMessageHandlerDescriptions_ReflectsActualResultType_ForIntResult()
    {
        // Arrange
        var factory = new QueryHandlerAdapterFactory(_loggerMock);
        Type handlerType = typeof(IntQueryHandlerMock);
        Type handlerInterface = typeof(IQueryHandler<IntQueryMock, int>);

        // Act
        var descriptions = factory.GetMessageHandlerDescriptions(handlerType, handlerInterface).ToList();

        // Assert
        descriptions.Should().HaveCount(1);
        var description = descriptions[0];
        description.MessageType.Should().Be(typeof(IntQueryMock));
        description.ReturnType.Should().Be(typeof(int));
        description.Method.Should().NotBeNull();
        description.Method!.Name.Should().Be(nameof(IntQueryHandlerMock.HandleAsync));
    }

    private record StringQueryMock : Query<string>;
    private record IntQueryMock : Query<int>;

    private class StringQueryHandlerMock : IQueryHandler<StringQueryMock, string>
    {
        public Task<Either<Exception, string>> HandleAsync(StringQueryMock query, IMessageContext messageContext, CancellationToken cancellationToken)
            => throw new NotImplementedException();
    }

    private class IntQueryHandlerMock : IQueryHandler<IntQueryMock, int>
    {
        public Task<Either<Exception, int>> HandleAsync(IntQueryMock query, IMessageContext messageContext, CancellationToken cancellationToken)
            => throw new NotImplementedException();
    }
}
