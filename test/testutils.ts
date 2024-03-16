export class TestUtils {

    static possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    static randomAlphanumeric(n: number = 10) {
        let text = '';
    
        for (let i = 0; i < n; i++) {
          text += TestUtils.possible.charAt(Math.floor(
            Math.random() * TestUtils.possible.length));
        }
    
        return text;
    }

}