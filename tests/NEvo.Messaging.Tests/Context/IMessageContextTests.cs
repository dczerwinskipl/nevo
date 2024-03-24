using NEvo.Messaging.Context;

namespace NEvo.Messaging.Tests.Context;

public class IMessageContextTests
{
    private readonly IMessageContext _sut;
    private readonly string _correlationId = "Correlation123";
    private readonly string _causationId = "Correlation123";

    public IMessageContextTests()
    {
        // Arrange
        var headersMock = new Mock<IMessageContextHeaders>();
        headersMock.Setup(h => h.CorrelationId).Returns(_correlationId);
        headersMock.Setup(h => h.CausationId).Returns(_causationId);

        var contextMock = new Mock<IMessageContext>() { CallBase = true };
        contextMock.Setup(m => m.Headers).Returns(headersMock.Object);
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
