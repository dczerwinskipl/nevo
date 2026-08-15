using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using NEvo.Ddd.EventSourcing.Executing;
using NEvo.Messaging.Context;

namespace NEvo.Ddd.EventSourcing.Tests.Executing;

public class AllowAllAggregateAuthorizationTests
{
    [Fact]
    public async Task AddEventSourcing_NoCommandSpecificPolicyRegistered_DefaultAuthorizationAllowsExecution_RegardlessOfAggregateState()
    {
        var services = new ServiceCollection();
        services.AddEventSourcing(typeof(Document));
        var provider = services.BuildServiceProvider();
        var authorization = provider.GetRequiredService<IAggregateAuthorization<CreateDocument, Document, Guid>>();
        var id = Guid.NewGuid();

        var noneResult = await authorization.AuthorizeAsync(new CreateDocument(id, "Data"), Option<Document>.None, new Mock<IMessageContext>().Object, CancellationToken.None);
        var someResult = await authorization.AuthorizeAsync(new CreateDocument(id, "Data"), new EditableDocument(id, "Data"), new Mock<IMessageContext>().Object, CancellationToken.None);

        noneResult.Should().BeRight();
        someResult.Should().BeRight();
    }
}
