using NEvo.Messaging.Context;

namespace NEvo.Messaging.Tests.Context;

public class IMessageContextTests
{
    private readonly IMessageContext _sut;
    private readonly string _correlationId = "Correlation123";
    private readonly string _causationId = "Causation123";

    public IMessageContextTests()
    {
        // Arrange
        var headers = new MessageContextHeaders
        {
            CorrelationId = _correlationId,
            CausationId = _causationId
        };

        var contextMock = new Mock<IMessageContext>() { CallBase = true };
        contextMock.Setup(m => m.Headers).Returns(headers);
        _sut = contextMock.Object;
    }

    [Fact]
    public void CorrelationId_ShouldCorrectlyRetrieveValue()
    {
        // Act & Assert
        _sut.CorrelationId.ExpectSome().Should().Be(_correlationId);
    }

    [Fact]
    public void CausationId_ShouldCorrectlyRetrieveValue()
    {
        // Act & Assert
        _sut.CausationId.ExpectSome().Should().Be(_causationId);
    }
}
